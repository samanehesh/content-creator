import { int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const userPromptSettings = mysqlTable("userPromptSettings", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  promptContent: text("promptContent").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const contentRuns = mysqlTable("contentRuns", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  topic: text("topic").notNull(),
  primaryKeyword: varchar("primaryKeyword", { length: 255 }),
  mascotEnabled: int("mascotEnabled").default(0).notNull(),
  status: varchar("status", { length: 48 }).default("draft").notNull(),
  currentStage: varchar("currentStage", { length: 64 }).default("idle").notNull(),
  lastError: text("lastError"),
  promptSnapshot: text("promptSnapshot"),
  articleTitle: text("articleTitle"),
  articleSummary: text("articleSummary"),
  seoTitle: text("seoTitle"),
  metaDescription: text("metaDescription"),
  urlSlug: varchar("urlSlug", { length: 255 }),
  articleMarkdown: text("articleMarkdown"),
  articleApproved: int("articleApproved").default(0).notNull(),
  shareToken: varchar("shareToken", { length: 64 }).unique(),
  sharedAt: timestamp("sharedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const generatedImages = mysqlTable("generatedImages", {
  id: int("id").autoincrement().primaryKey(),
  runId: int("runId").notNull(),
  angleId: int("angleId").notNull(),
  angleLabel: varchar("angleLabel", { length: 64 }).notNull(),
  angleNote: text("angleNote"),
  revisionNote: text("revisionNote"),
  prompt: text("prompt").notNull(),
  mimeType: varchar("mimeType", { length: 64 }).default("image/webp").notNull(),
  storageKey: varchar("storageKey", { length: 255 }),
  imageUrl: text("imageUrl"),
  fileName: varchar("fileName", { length: 255 }),
  sizeBytes: int("sizeBytes"),
  width: int("width"),
  height: int("height"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export type UserPromptSetting = typeof userPromptSettings.$inferSelect;
export type InsertUserPromptSetting = typeof userPromptSettings.$inferInsert;

export type ContentRun = typeof contentRuns.$inferSelect;
export type InsertContentRun = typeof contentRuns.$inferInsert;

export type GeneratedImage = typeof generatedImages.$inferSelect;
export type InsertGeneratedImage = typeof generatedImages.$inferInsert;
