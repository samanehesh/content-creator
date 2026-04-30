import { boolean, integer, pgEnum, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("role", ["user", "admin"]);

export const users = pgTable("users", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: userRoleEnum("role").default("user").notNull(),
  createdAt: timestamp("createdAt", { withTimezone: false }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: false }).defaultNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn", { withTimezone: false }).defaultNow().notNull(),
});

export const userPromptSettings = pgTable("userPromptSettings", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  userId: integer("userId").notNull().unique(),
  promptContent: text("promptContent").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export const brandProfiles = pgTable("brandProfiles", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  userId: integer("userId").notNull(),
  profileName: text("profileName").notNull(),
  masterPrompt: text("masterPrompt").notNull(),
  logoStorageKey: text("logoStorageKey"),
  logoUrl: text("logoUrl"),
  referenceStorageKey: text("referenceStorageKey"),
  referenceUrl: text("referenceUrl"),
  isDefault: boolean("isDefault").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export const contentRuns = pgTable("contentRuns", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  userId: integer("userId").notNull(),
  topic: text("topic").notNull(),
  primaryKeyword: varchar("primaryKeyword", { length: 255 }),
  mascotEnabled: boolean("mascotEnabled").default(false).notNull(),
  status: varchar("status", { length: 48 }).default("draft").notNull(),
  currentStage: varchar("currentStage", { length: 64 }).default("idle").notNull(),
  lastError: text("lastError"),
  promptSnapshot: text("promptSnapshot"),
  brandProfileId: integer("brandProfileId"),
  brandProfileNameSnapshot: text("brandProfileNameSnapshot"),
  masterPromptSnapshot: text("masterPromptSnapshot"),
  logoSnapshotKey: text("logoSnapshotKey"),
  logoSnapshotUrl: text("logoSnapshotUrl"),
  referenceSnapshotKey: text("referenceSnapshotKey"),
  referenceSnapshotUrl: text("referenceSnapshotUrl"),
  articleTitle: text("articleTitle"),
  articleSummary: text("articleSummary"),
  seoTitle: text("seoTitle"),
  metaDescription: text("metaDescription"),
  urlSlug: varchar("urlSlug", { length: 255 }),
  articleMarkdown: text("articleMarkdown"),
  articleApproved: boolean("articleApproved").default(false).notNull(),
  shareToken: varchar("shareToken", { length: 64 }).unique(),
  sharedAt: timestamp("sharedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export const generatedImages = pgTable("generatedImages", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  runId: integer("runId").notNull(),
  angleId: integer("angleId").notNull(),
  angleLabel: varchar("angleLabel", { length: 64 }).notNull(),
  angleNote: text("angleNote"),
  revisionNote: text("revisionNote"),
  prompt: text("prompt").notNull(),
  provider: text("provider").notNull().default("openai"),
  model: text("model"),
  revisedPrompt: text("revisedPrompt"),
  mimeType: varchar("mimeType", { length: 64 }).default("image/webp").notNull(),
  storageKey: varchar("storageKey", { length: 255 }),
  imageUrl: text("imageUrl"),
  fileName: varchar("fileName", { length: 255 }),
  sizeBytes: integer("sizeBytes"),
  width: integer("width"),
  height: integer("height"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type UserPromptSetting = typeof userPromptSettings.$inferSelect;
export type InsertUserPromptSetting = typeof userPromptSettings.$inferInsert;
export type BrandProfile = typeof brandProfiles.$inferSelect;
export type InsertBrandProfile = typeof brandProfiles.$inferInsert;
export type ContentRun = typeof contentRuns.$inferSelect;
export type InsertContentRun = typeof contentRuns.$inferInsert;
export type GeneratedImage = typeof generatedImages.$inferSelect;
export type InsertGeneratedImage = typeof generatedImages.$inferInsert;
