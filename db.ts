import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  contentRuns,
  generatedImages,
  InsertGeneratedImage,
  InsertUser,
  userPromptSettings,
  users,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }

  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  const values: InsertUser = {
    openId: user.openId,
  };
  const updateSet: Record<string, unknown> = {};

  const textFields = ["name", "email", "loginMethod"] as const;
  type TextField = (typeof textFields)[number];

  const assignNullable = (field: TextField) => {
    const value = user[field];
    if (value === undefined) return;
    const normalized = value ?? null;
    values[field] = normalized;
    updateSet[field] = normalized;
  };

  textFields.forEach(assignNullable);

  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }

  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }

  if (!values.lastSignedIn) {
    values.lastSignedIn = new Date();
  }

  if (Object.keys(updateSet).length === 0) {
    updateSet.lastSignedIn = new Date();
  }

  await db.insert(users).values(values).onDuplicateKeyUpdate({
    set: updateSet,
  });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getSavedPromptForUser(userId: number) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database is not available.");
  }

  const rows = await db
    .select()
    .from(userPromptSettings)
    .where(eq(userPromptSettings.userId, userId))
    .limit(1);

  return rows[0];
}

export function readInsertId(result: unknown): number {
  if (typeof result === "number" && Number.isFinite(result)) {
    return result;
  }

  if (Array.isArray(result)) {
    for (const entry of result) {
      const extracted = readInsertId(entry);
      if (Number.isFinite(extracted)) {
        return extracted;
      }
    }
  }

  if (result && typeof result === "object") {
    const insertId = Reflect.get(result, "insertId");
    if (typeof insertId === "number" && Number.isFinite(insertId)) {
      return insertId;
    }

    const id = Reflect.get(result, "id");
    if (typeof id === "number" && Number.isFinite(id)) {
      return id;
    }
  }

  throw new Error("Insert operation did not return a valid numeric ID.");
}

export async function savePromptForUser(userId: number, promptContent: string) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database is not available.");
  }

  const normalizedPrompt = promptContent.trim();
  const existing = await getSavedPromptForUser(userId);

  if (existing) {
    await db
      .update(userPromptSettings)
      .set({
        promptContent: normalizedPrompt,
        updatedAt: new Date(),
      })
      .where(eq(userPromptSettings.id, existing.id));

    return existing.id;
  }

  const result = await db.insert(userPromptSettings).values({
    userId,
    promptContent: normalizedPrompt,
  });

  return readInsertId(result);
}

export async function createContentRun(input: {
  userId: number;
  topic: string;
  primaryKeyword?: string;
  mascotEnabled: boolean;
  promptSnapshot?: string | null;
}) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database is not available.");
  }

  const result = await db.insert(contentRuns).values({
    userId: input.userId,
    topic: input.topic,
    primaryKeyword: input.primaryKeyword || null,
    mascotEnabled: input.mascotEnabled ? 1 : 0,
    status: "draft",
    currentStage: "idle",
    articleApproved: 0,
    promptSnapshot: input.promptSnapshot?.trim() || null,
  });

  return readInsertId(result);
}

export async function getContentRunById(runId: number, userId: number) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database is not available.");
  }

  const rows = await db
    .select()
    .from(contentRuns)
    .where(and(eq(contentRuns.id, runId), eq(contentRuns.userId, userId)))
    .limit(1);

  return rows[0];
}

export async function createOrGetShareTokenForRun(runId: number, userId: number) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database is not available.");
  }

  const run = await getContentRunById(runId, userId);
  if (!run) {
    throw new Error("Content run was not found.");
  }

  if (run.shareToken?.trim()) {
    return run.shareToken.trim();
  }

  const shareToken = randomUUID().replace(/-/g, "");

  await db
    .update(contentRuns)
    .set({
      shareToken,
      sharedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(contentRuns.id, runId), eq(contentRuns.userId, userId)));

  return shareToken;
}

export async function getSharedContentRunByToken(shareToken: string) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database is not available.");
  }

  const rows = await db
    .select()
    .from(contentRuns)
    .where(eq(contentRuns.shareToken, shareToken.trim()))
    .limit(1);

  const run = rows[0];
  if (!run) {
    return undefined;
  }

  const images = await listGeneratedImagesForRun(run.id);
  return {
    ...run,
    images,
  };
}

export async function updateContentRunStage(input: {
  runId: number;
  userId: number;
  currentStage: string;
  status: string;
  lastError?: string | null;
}) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database is not available.");
  }

  await db
    .update(contentRuns)
    .set({
      currentStage: input.currentStage,
      status: input.status,
      lastError: input.lastError ?? null,
      updatedAt: new Date(),
    })
    .where(and(eq(contentRuns.id, input.runId), eq(contentRuns.userId, input.userId)));
}

export async function saveGeneratedArticle(input: {
  runId: number;
  userId: number;
  articleTitle: string;
  articleSummary: string;
  articleMarkdown: string;
  seoTitle: string;
  metaDescription: string;
  urlSlug: string;
  articleApproved: boolean;
  currentStage: string;
  status: string;
  mascotEnabled: boolean;
  lastError?: string | null;
}) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database is not available.");
  }

  await db
    .update(contentRuns)
    .set({
      articleTitle: input.articleTitle,
      articleSummary: input.articleSummary,
      articleMarkdown: input.articleMarkdown,
      seoTitle: input.seoTitle,
      metaDescription: input.metaDescription,
      urlSlug: input.urlSlug,
      articleApproved: input.articleApproved ? 1 : 0,
      mascotEnabled: input.mascotEnabled ? 1 : 0,
      currentStage: input.currentStage,
      status: input.status,
      lastError: input.lastError ?? null,
      updatedAt: new Date(),
    })
    .where(and(eq(contentRuns.id, input.runId), eq(contentRuns.userId, input.userId)));
}

export async function getGeneratedImageForAngle(runId: number, angleId: number) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database is not available.");
  }

  const rows = await db
    .select()
    .from(generatedImages)
    .where(and(eq(generatedImages.runId, runId), eq(generatedImages.angleId, angleId)))
    .limit(1);

  return rows[0];
}

export async function upsertGeneratedImage(
  userId: number,
  runId: number,
  image: Omit<InsertGeneratedImage, "runId">,
) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database is not available.");
  }

  const run = await getContentRunById(runId, userId);
  if (!run) {
    throw new Error("Content run was not found.");
  }

  const existing = await getGeneratedImageForAngle(runId, Number(image.angleId));

  if (existing) {
    await db
      .update(generatedImages)
      .set({
        angleLabel: image.angleLabel,
        angleNote: image.angleNote ?? null,
        revisionNote: image.revisionNote ?? null,
        prompt: image.prompt,
        mimeType: image.mimeType,
        storageKey: image.storageKey ?? null,
        imageUrl: image.imageUrl ?? null,
        fileName: image.fileName ?? null,
        sizeBytes: image.sizeBytes ?? null,
        width: image.width ?? null,
        height: image.height ?? null,
        updatedAt: new Date(),
      })
      .where(eq(generatedImages.id, existing.id));

    return existing.id;
  }

  const result = await db.insert(generatedImages).values({
    ...image,
    runId,
  });

  return readInsertId(result);
}

export async function listGeneratedImagesForRun(runId: number) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database is not available.");
  }

  const rows = await db.select().from(generatedImages).where(eq(generatedImages.runId, runId));
  return rows.sort((left, right) => left.angleId - right.angleId);
}

export async function listContentRunsForUser(userId: number) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database is not available.");
  }

  const runs = await db
    .select()
    .from(contentRuns)
    .where(eq(contentRuns.userId, userId))
    .orderBy(desc(contentRuns.updatedAt));

  if (runs.length === 0) {
    return [] as Array<(typeof runs)[number] & { images: Awaited<ReturnType<typeof listGeneratedImagesForRun>> }>;
  }

  const runIds = runs.map(run => run.id);
  const images = await db.select().from(generatedImages).where(inArray(generatedImages.runId, runIds));

  const imagesByRun = new Map<number, typeof images>();
  for (const image of images) {
    const current = imagesByRun.get(image.runId) ?? [];
    current.push(image);
    imagesByRun.set(image.runId, current);
  }

  return runs.map(run => ({
    ...run,
    images: (imagesByRun.get(run.id) ?? []).sort((left, right) => left.angleId - right.angleId),
  }));
}
