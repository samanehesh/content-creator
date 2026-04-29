import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const dbMocks = vi.hoisted(() => ({
  getSavedPromptForUser: vi.fn(),
  savePromptForUser: vi.fn(),
  createContentRun: vi.fn(),
  createOrGetShareTokenForRun: vi.fn(),
  updateContentRunStage: vi.fn(),
  saveGeneratedArticle: vi.fn(),
  getContentRunById: vi.fn(),
  getSharedContentRunByToken: vi.fn(),
  listContentRunsForUser: vi.fn(),
  listGeneratedImagesForRun: vi.fn(),
  upsertGeneratedImage: vi.fn(),
}));

const serviceMocks = vi.hoisted(() => ({
  getBundledMasterPromptTemplate: vi.fn(),
  generateArticleFromTopic: vi.fn(),
  generateBrandedImage: vi.fn(),
  normalizeArticleEditorInput: vi.fn(),
}));

vi.mock("./db", () => dbMocks);
vi.mock("./contentService", () => serviceMocks);

const { appRouter } = await import("./routers");

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 7,
    openId: "prompt-user",
    email: "prompt@example.com",
    name: "Prompt User",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  return {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
    } as TrpcContext["res"],
  };
}

describe("prompt settings workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.getSavedPromptForUser.mockResolvedValue(undefined);
    dbMocks.savePromptForUser.mockResolvedValue(1);
    dbMocks.createContentRun.mockResolvedValue(42);
    dbMocks.updateContentRunStage.mockResolvedValue(undefined);
    dbMocks.saveGeneratedArticle.mockResolvedValue(undefined);
    dbMocks.listGeneratedImagesForRun.mockResolvedValue([]);
    serviceMocks.getBundledMasterPromptTemplate.mockResolvedValue("Bundled {{TOPIC}} {{PRIMARY_KEYWORD}}");
    serviceMocks.generateArticleFromTopic.mockResolvedValue({
      articleTitle: "Prompted title",
      articleSummary: "A saved or overridden prompt produced this summary for the article workflow.",
      articleMarkdown: "# Prompted title\n\nThis is a sufficiently long article body for the mocked router test.",
      seoTitle: "Prompted SEO title",
      metaDescription: "Prompted meta description that is long enough for validation.",
      urlSlug: "prompted-title",
    });
  });

  it("returns the saved prompt when one exists", async () => {
    dbMocks.getSavedPromptForUser.mockResolvedValue({ promptContent: "Saved prompt body" });
    const caller = appRouter.createCaller(createAuthContext());

    const result = await caller.content.promptSettings();

    expect(result).toEqual({
      bundledPrompt: "Bundled {{TOPIC}} {{PRIMARY_KEYWORD}}",
      promptContent: "Saved prompt body",
      hasSavedPrompt: true,
    });
  });

  it("saves a new default prompt for the current user", async () => {
    const caller = appRouter.createCaller(createAuthContext());

    const result = await caller.content.savePromptSettings({
      promptContent: "This is a newly saved prompt template that is definitely longer than fifty characters.",
    });

    expect(dbMocks.savePromptForUser).toHaveBeenCalledWith(
      7,
      "This is a newly saved prompt template that is definitely longer than fifty characters.",
    );
    expect(result).toEqual({
      success: true,
      promptContent: "This is a newly saved prompt template that is definitely longer than fifty characters.",
    });
  });

  it("uses a run-specific prompt override and stores it on the content run", async () => {
    const caller = appRouter.createCaller(createAuthContext());
    const override = "Custom prompt override for this run that is comfortably above the minimum required length.";

    await caller.content.generateArticle({
      topic: "How to prepare for TEF speaking",
      primaryKeyword: "TEF speaking tips",
      mascotEnabled: true,
      promptOverride: override,
    });

    expect(dbMocks.createContentRun).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        promptSnapshot: override,
      }),
    );
    expect(serviceMocks.generateArticleFromTopic).toHaveBeenCalledWith(
      "How to prepare for TEF speaking",
      "TEF speaking tips",
      override,
    );
  });

  it("falls back to the saved prompt when no run-specific override is provided", async () => {
    dbMocks.getSavedPromptForUser.mockResolvedValue({
      promptContent: "Saved prompt used automatically for this run because no override was supplied.",
    });
    const caller = appRouter.createCaller(createAuthContext());

    await caller.content.generateArticle({
      topic: "How to rebook a TEF exam",
      mascotEnabled: false,
    });

    expect(serviceMocks.generateArticleFromTopic).toHaveBeenCalledWith(
      "How to rebook a TEF exam",
      undefined,
      "Saved prompt used automatically for this run because no override was supplied.",
    );
  });
});
