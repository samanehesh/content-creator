-- PostgreSQL/Supabase compatibility migration
CREATE TYPE IF NOT EXISTS "role" AS ENUM ('user', 'admin');

CREATE TABLE IF NOT EXISTS "brandProfiles" (
  "id" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "userId" integer NOT NULL,
  "profileName" text NOT NULL,
  "masterPrompt" text NOT NULL,
  "logoStorageKey" text,
  "logoUrl" text,
  "referenceStorageKey" text,
  "referenceUrl" text,
  "isDefault" boolean DEFAULT false NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "contentRuns" ADD COLUMN IF NOT EXISTS "brandProfileId" integer;
ALTER TABLE "contentRuns" ADD COLUMN IF NOT EXISTS "brandProfileNameSnapshot" text;
ALTER TABLE "contentRuns" ADD COLUMN IF NOT EXISTS "masterPromptSnapshot" text;
ALTER TABLE "contentRuns" ADD COLUMN IF NOT EXISTS "logoSnapshotKey" text;
ALTER TABLE "contentRuns" ADD COLUMN IF NOT EXISTS "logoSnapshotUrl" text;
ALTER TABLE "contentRuns" ADD COLUMN IF NOT EXISTS "referenceSnapshotKey" text;
ALTER TABLE "contentRuns" ADD COLUMN IF NOT EXISTS "referenceSnapshotUrl" text;

ALTER TABLE "generatedImages" ADD COLUMN IF NOT EXISTS "provider" text DEFAULT 'openai' NOT NULL;
ALTER TABLE "generatedImages" ADD COLUMN IF NOT EXISTS "model" text;
ALTER TABLE "generatedImages" ADD COLUMN IF NOT EXISTS "revisedPrompt" text;
