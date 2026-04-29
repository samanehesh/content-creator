import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import {
  generateArticleFromTopic,
  getBundledMasterPromptTemplate,
  generateBrandedImage,
  normalizeArticleEditorInput,
} from "./contentService";
import {
  createContentRun,
  createOrGetShareTokenForRun,
  getContentRunById,
  getSavedPromptForUser,
  getSharedContentRunByToken,
  listContentRunsForUser,
  listGeneratedImagesForRun,
  saveGeneratedArticle,
  savePromptForUser,
  updateContentRunStage,
  upsertGeneratedImage,
} from "./db";

const articleInputSchema = z.object({
  topic: z.string().trim().min(4).max(240),
  primaryKeyword: z.string().trim().max(240).optional(),
  mascotEnabled: z.boolean().default(false),
  promptOverride: z.string().trim().min(50).max(40000).optional(),
});

const savePromptSchema = z.object({
  promptContent: z.string().trim().min(50).max(40000),
});

const saveArticleSchema = z.object({
  runId: z.number().int().positive(),
  articleTitle: z.string().trim().min(5).max(240),
  articleSummary: z.string().trim().min(20).max(500),
  articleMarkdown: z.string().trim().min(100),
  seoTitle: z.string().trim().max(240).optional(),
  metaDescription: z.string().trim().max(320).optional(),
  urlSlug: z.string().trim().max(240).optional(),
  mascotEnabled: z.boolean().default(false),
});

const imageInputSchema = z.object({
  runId: z.number().int().positive(),
  angleId: z.number().int().min(1).max(3),
  mascotEnabled: z.boolean().default(false),
  angleNote: z.string().trim().max(500).optional(),
  revisionNote: z.string().trim().max(500).optional(),
});

const shareRunSchema = z.object({
  runId: z.number().int().positive(),
  origin: z.string().url().max(2000),
});

const sharedRunSchema = z.object({
  token: z.string().trim().min(16).max(64),
});

async function resolveEffectivePrompt(userId: number, promptOverride?: string) {
  const override = promptOverride?.trim();
  if (override) {
    return override;
  }

  const savedPrompt = await getSavedPromptForUser(userId);
  if (savedPrompt?.promptContent?.trim()) {
    return savedPrompt.promptContent.trim();
  }

  return getBundledMasterPromptTemplate();
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  content: router({
    history: protectedProcedure.query(async ({ ctx }) => {
      return listContentRunsForUser(ctx.user.id);
    }),

    promptSettings: protectedProcedure.query(async ({ ctx }) => {
      const bundledPrompt = await getBundledMasterPromptTemplate();
      const savedPrompt = await getSavedPromptForUser(ctx.user.id);

      return {
        bundledPrompt,
        promptContent: savedPrompt?.promptContent?.trim() || bundledPrompt,
        hasSavedPrompt: Boolean(savedPrompt?.promptContent?.trim()),
      };
    }),

    savePromptSettings: protectedProcedure.input(savePromptSchema).mutation(async ({ ctx, input }) => {
      await savePromptForUser(ctx.user.id, input.promptContent);
      return {
        success: true,
        promptContent: input.promptContent.trim(),
      };
    }),

    getRun: protectedProcedure
      .input(z.object({ runId: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        const run = await getContentRunById(input.runId, ctx.user.id);
        if (!run) {
          throw new TRPCError({ code: "NOT_FOUND", message: "The selected content run could not be found." });
        }

        const images = await listGeneratedImagesForRun(input.runId);
        return { ...run, images };
      }),

    generateArticle: protectedProcedure.input(articleInputSchema).mutation(async ({ ctx, input }) => {
      const effectivePrompt = await resolveEffectivePrompt(ctx.user.id, input.promptOverride);
      const runId = await createContentRun({
        userId: ctx.user.id,
        topic: input.topic,
        primaryKeyword: input.primaryKeyword,
        mascotEnabled: input.mascotEnabled,
        promptSnapshot: effectivePrompt,
      });

      await updateContentRunStage({
        runId,
        userId: ctx.user.id,
        currentStage: "article",
        status: "running",
        lastError: null,
      });

      try {
        const article = await generateArticleFromTopic(input.topic, input.primaryKeyword, effectivePrompt);

        await saveGeneratedArticle({
          runId,
          userId: ctx.user.id,
          ...article,
          articleApproved: false,
          mascotEnabled: input.mascotEnabled,
          currentStage: "article-ready",
          status: "ready",
          lastError: null,
        });

        return {
          runId,
          ...article,
          mascotEnabled: input.mascotEnabled,
          promptSnapshot: effectivePrompt,
          images: [],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Article generation failed.";

        await updateContentRunStage({
          runId,
          userId: ctx.user.id,
          currentStage: "article",
          status: "error",
          lastError: message,
        });

        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message });
      }
    }),

    saveArticle: protectedProcedure.input(saveArticleSchema).mutation(async ({ ctx, input }) => {
      const run = await getContentRunById(input.runId, ctx.user.id);
      if (!run) {
        throw new TRPCError({ code: "NOT_FOUND", message: "The selected content run could not be found." });
      }

      const normalized = normalizeArticleEditorInput({
        articleTitle: input.articleTitle,
        articleSummary: input.articleSummary,
        articleMarkdown: input.articleMarkdown,
        seoTitle: input.seoTitle,
        metaDescription: input.metaDescription,
        urlSlug: input.urlSlug,
      });

      await saveGeneratedArticle({
        runId: input.runId,
        userId: ctx.user.id,
        ...normalized,
        articleApproved: true,
        mascotEnabled: input.mascotEnabled,
        currentStage: "article-approved",
        status: "ready",
        lastError: null,
      });

      const images = await listGeneratedImagesForRun(input.runId);
      return { runId: input.runId, ...normalized, promptSnapshot: run.promptSnapshot, images };
    }),

    generateImage: protectedProcedure.input(imageInputSchema).mutation(async ({ ctx, input }) => {
      const run = await getContentRunById(input.runId, ctx.user.id);
      if (!run) {
        throw new TRPCError({ code: "NOT_FOUND", message: "The selected content run could not be found." });
      }
      if (!run.articleTitle || !run.articleSummary) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Please generate and save the article before requesting images.",
        });
      }

      const stageKey = `image-${input.angleId}`;
      await updateContentRunStage({
        runId: input.runId,
        userId: ctx.user.id,
        currentStage: stageKey,
        status: "running",
        lastError: null,
      });

      try {
        const image = await generateBrandedImage({
          userId: ctx.user.id,
          runId: input.runId,
          angleId: input.angleId,
          articleTitle: run.articleTitle,
          articleSummary: run.articleSummary,
          angleNote: input.angleNote,
          revisionNote: input.revisionNote,
          mascotEnabled: input.mascotEnabled,
        });

        await upsertGeneratedImage(ctx.user.id, input.runId, image);
        const images = await listGeneratedImagesForRun(input.runId);

        await updateContentRunStage({
          runId: input.runId,
          userId: ctx.user.id,
          currentStage: images.length >= 3 ? "complete" : stageKey,
          status: "ready",
          lastError: null,
        });

        return {
          ...image,
          allImages: images,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Image generation failed.";

        await updateContentRunStage({
          runId: input.runId,
          userId: ctx.user.id,
          currentStage: stageKey,
          status: "error",
          lastError: message,
        });

        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message });
      }
    }),

    shareRun: protectedProcedure.input(shareRunSchema).mutation(async ({ ctx, input }) => {
      const run = await getContentRunById(input.runId, ctx.user.id);
      if (!run) {
        throw new TRPCError({ code: "NOT_FOUND", message: "The selected content run could not be found." });
      }
      if (!run.articleMarkdown || !run.articleTitle) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Generate and save the article before creating a share link.",
        });
      }

      const token = await createOrGetShareTokenForRun(input.runId, ctx.user.id);
      const shareUrl = new URL(`/share/${token}`, input.origin).toString();

      return {
        shareToken: token,
        shareUrl,
      };
    }),

    sharedRun: publicProcedure.input(sharedRunSchema).query(async ({ input }) => {
      const run = await getSharedContentRunByToken(input.token);
      if (!run) {
        throw new TRPCError({ code: "NOT_FOUND", message: "This shared content run could not be found." });
      }
      if (!run.articleMarkdown || !run.articleTitle) {
        throw new TRPCError({ code: "NOT_FOUND", message: "This shared content run is no longer available." });
      }

      return {
        id: run.id,
        topic: run.topic,
        primaryKeyword: run.primaryKeyword,
        mascotEnabled: run.mascotEnabled,
        status: run.status,
        currentStage: run.currentStage,
        articleTitle: run.articleTitle,
        articleSummary: run.articleSummary,
        seoTitle: run.seoTitle,
        metaDescription: run.metaDescription,
        urlSlug: run.urlSlug,
        articleMarkdown: run.articleMarkdown,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
        sharedAt: run.sharedAt,
        images: run.images,
      };
    }),
  }),
});

export type AppRouter = typeof appRouter;
