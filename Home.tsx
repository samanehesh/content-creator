import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import {
  ArrowRight,
  BadgeCheck,
  Bot,
  CheckCircle2,
  Clock3,
  Copy,
  Download,
  FileText,
  History,
  ImageIcon,
  Loader2,
  RefreshCcw,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import { Streamdown } from "streamdown";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

const angleDefinitions = [
  { id: 1, label: "Overview scene", shortLabel: "Overview", placeholder: "Optional guidance for the establishing scene." },
  { id: 2, label: "Action / close-up", shortLabel: "Action", placeholder: "Optional guidance for the action shot." },
  { id: 3, label: "Outcome / result", shortLabel: "Outcome", placeholder: "Optional guidance for the success scene." },
] as const;

const stageMetadata = {
  article: { label: "Article generation", helper: "Claude writes the article from your master prompt." },
  "image-1": { label: "Image 1", helper: "Overview scene" },
  "image-2": { label: "Image 2", helper: "Action / close-up" },
  "image-3": { label: "Image 3", helper: "Outcome / result" },
} as const;

type StageKey = keyof typeof stageMetadata;
type StageState = "idle" | "running" | "success" | "error";
type PromptMode = "saved" | "override";
type StageStatusMap = Record<StageKey, { state: StageState; message?: string }>;

type PersistedImage = {
  id?: number;
  angleId: number;
  angleLabel: string;
  angleNote: string | null;
  revisionNote: string | null;
  prompt: string;
  mimeType: string | null;
  storageKey: string | null;
  imageUrl: string | null;
  fileName: string | null;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
};

type PersistedRun = {
  id: number;
  topic: string;
  primaryKeyword: string | null;
  mascotEnabled: number;
  status: string;
  currentStage: string;
  lastError: string | null;
  promptSnapshot: string | null;
  articleTitle: string | null;
  articleSummary: string | null;
  seoTitle: string | null;
  metaDescription: string | null;
  urlSlug: string | null;
  articleMarkdown: string | null;
  articleApproved: number;
  shareToken: string | null;
  sharedAt: string | Date | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  images: PersistedImage[];
};

function createStageMap(): StageStatusMap {
  return {
    article: { state: "idle" },
    "image-1": { state: "idle" },
    "image-2": { state: "idle" },
    "image-3": { state: "idle" },
  };
}

function imageMapFromArray(images: PersistedImage[]) {
  return images.reduce<Record<number, PersistedImage>>((accumulator, image) => {
    accumulator[image.angleId] = image;
    return accumulator;
  }, {});
}

function stageMapFromRun(run: PersistedRun): StageStatusMap {
  const next = createStageMap();

  if (run.articleMarkdown) {
    next.article = { state: "success" };
  }

  for (const image of run.images) {
    const key = `image-${image.angleId}` as StageKey;
    next[key] = { state: "success" };
  }

  if (run.status === "error") {
    const key = run.currentStage as StageKey;
    if (next[key]) {
      next[key] = { state: "error", message: run.lastError || "A retry is available for this stage." };
    }
  }

  return next;
}

function formatTimestamp(value: string | Date) {
  return new Date(value).toLocaleString();
}

function stageTone(stage: StageState) {
  if (stage === "success") return "text-emerald-600 bg-emerald-500/10 border-emerald-500/20";
  if (stage === "running") return "text-primary bg-primary/10 border-primary/20";
  if (stage === "error") return "text-destructive bg-destructive/10 border-destructive/20";
  return "text-muted-foreground bg-muted/60 border-border";
}

export default function Home() {
  const historyQuery = trpc.content.history.useQuery();
  const promptSettingsQuery = trpc.content.promptSettings.useQuery();
  const generateArticleMutation = trpc.content.generateArticle.useMutation();
  const saveArticleMutation = trpc.content.saveArticle.useMutation();
  const savePromptMutation = trpc.content.savePromptSettings.useMutation();
  const generateImageMutation = trpc.content.generateImage.useMutation();
  const shareRunMutation = trpc.content.shareRun.useMutation();

  const history = (historyQuery.data ?? []) as PersistedRun[];
  const [topic, setTopic] = useState("");
  const [primaryKeyword, setPrimaryKeyword] = useState("");
  const [mascotEnabled, setMascotEnabled] = useState(false);
  const [articleTitle, setArticleTitle] = useState("");
  const [articleSummary, setArticleSummary] = useState("");
  const [seoTitle, setSeoTitle] = useState("");
  const [metaDescription, setMetaDescription] = useState("");
  const [urlSlug, setUrlSlug] = useState("");
  const [articleMarkdown, setArticleMarkdown] = useState("");
  const [articleApproved, setArticleApproved] = useState(false);
  const [activeRunId, setActiveRunId] = useState<number | null>(null);
  const [angleNotes, setAngleNotes] = useState<string[]>(["", "", ""]);
  const [revisionNotes, setRevisionNotes] = useState<string[]>(["", "", ""]);
  const [imagesByAngle, setImagesByAngle] = useState<Record<number, PersistedImage>>({});
  const [stages, setStages] = useState<StageStatusMap>(createStageMap());
  const [promptEditor, setPromptEditor] = useState("");
  const [bundledPrompt, setBundledPrompt] = useState("");
  const [promptInitialized, setPromptInitialized] = useState(false);
  const [promptMode, setPromptMode] = useState<PromptMode>("override");
  const [copiedShareRunId, setCopiedShareRunId] = useState<number | null>(null);

  useEffect(() => {
    if (!promptSettingsQuery.data || promptInitialized) {
      return;
    }

    setPromptEditor(promptSettingsQuery.data.promptContent || promptSettingsQuery.data.bundledPrompt);
    setBundledPrompt(promptSettingsQuery.data.bundledPrompt);
    setPromptMode(promptSettingsQuery.data.hasSavedPrompt ? "saved" : "override");
    setPromptInitialized(true);
  }, [promptInitialized, promptSettingsQuery.data]);

  const completedStages = useMemo(() => {
    return (Object.keys(stageMetadata) as StageKey[]).filter(stage => stages[stage].state === "success").length;
  }, [stages]);

  const progressValue = Math.round((completedStages / Object.keys(stageMetadata).length) * 100);
  const isGeneratingAny = generateArticleMutation.isPending || generateImageMutation.isPending;
  const hasSavedPrompt = Boolean(promptSettingsQuery.data?.hasSavedPrompt);

  const setStage = (key: StageKey, state: StageState, message?: string) => {
    setStages(current => ({
      ...current,
      [key]: { state, message },
    }));
  };

  const hydrateFromRun = (run: PersistedRun) => {
    setActiveRunId(run.id);
    setTopic(run.topic);
    setPrimaryKeyword(run.primaryKeyword || "");
    setMascotEnabled(Boolean(run.mascotEnabled));
    setArticleTitle(run.articleTitle || "");
    setArticleSummary(run.articleSummary || "");
    setSeoTitle(run.seoTitle || run.articleTitle || "");
    setMetaDescription(run.metaDescription || run.articleSummary || "");
    setUrlSlug(run.urlSlug || "");
    setArticleMarkdown(run.articleMarkdown || "");
    setArticleApproved(Boolean(run.articleApproved));
    if (run.promptSnapshot?.trim()) {
      setPromptEditor(run.promptSnapshot.trim());
      setPromptMode("override");
    }
    setImagesByAngle(imageMapFromArray(run.images));
    setAngleNotes(angleDefinitions.map(angle => run.images.find(image => image.angleId === angle.id)?.angleNote || ""));
    setRevisionNotes(angleDefinitions.map(angle => run.images.find(image => image.angleId === angle.id)?.revisionNote || ""));
    setStages(stageMapFromRun(run));
    toast.success("Loaded saved generation run.");
  };

  const resetForFreshRun = () => {
    setActiveRunId(null);
    setArticleTitle("");
    setArticleSummary("");
    setSeoTitle("");
    setMetaDescription("");
    setUrlSlug("");
    setArticleMarkdown("");
    setArticleApproved(false);
    setImagesByAngle({});
    setRevisionNotes(["", "", ""]);
    setStages(createStageMap());
  };

  const handleSavePromptSettings = async () => {
    if (promptEditor.trim().length < 50) {
      toast.error("Please keep the master prompt at least 50 characters long before saving it.");
      return;
    }

    try {
      await savePromptMutation.mutateAsync({
        promptContent: promptEditor.trim(),
      });
      await promptSettingsQuery.refetch();
      setPromptMode("saved");
      toast.success("Saved this prompt as your default master prompt.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Saving the master prompt failed.");
    }
  };

  const handleResetPromptToBundled = () => {
    if (!bundledPrompt.trim()) {
      toast.error("The bundled prompt is still loading.");
      return;
    }

    setPromptEditor(bundledPrompt);
    setPromptMode("override");
    toast.success("Prompt editor reset to the bundled default prompt.");
  };

  const handleGenerateArticle = async () => {
    if (!topic.trim()) {
      toast.error("Please enter a topic before generating the article.");
      return;
    }
    if (promptEditor.trim().length < 50) {
      toast.error("Please provide a valid master prompt before generating the article.");
      return;
    }

    resetForFreshRun();
    setStage("article", "running", "Claude is generating the article.");

    try {
      const result = await generateArticleMutation.mutateAsync({
        topic: topic.trim(),
        primaryKeyword: primaryKeyword.trim() || undefined,
        mascotEnabled,
        promptOverride: promptMode === "override" ? promptEditor.trim() : undefined,
      });

      setActiveRunId(result.runId);
      setArticleTitle(result.articleTitle);
      setArticleSummary(result.articleSummary);
      setSeoTitle(result.seoTitle);
      setMetaDescription(result.metaDescription);
      setUrlSlug(result.urlSlug);
      setArticleMarkdown(result.articleMarkdown);
      setArticleApproved(false);
      setStage("article", "success", "Article ready for review.");
      await historyQuery.refetch();
      toast.success("Article generated. Review and approve it before producing images.");
      window.history.replaceState(null, "", "#article-review");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Article generation failed.";
      setStage("article", "error", message);
      toast.error(message);
    }
  };

  const handleSaveArticle = async () => {
    if (!activeRunId) {
      toast.error("Generate an article first.");
      return;
    }

    try {
      const result = await saveArticleMutation.mutateAsync({
        runId: activeRunId,
        articleTitle: articleTitle.trim(),
        articleSummary: articleSummary.trim(),
        articleMarkdown: articleMarkdown.trim(),
        seoTitle: seoTitle.trim() || undefined,
        metaDescription: metaDescription.trim() || undefined,
        urlSlug: urlSlug.trim() || undefined,
        mascotEnabled,
      });

      setArticleTitle(result.articleTitle);
      setArticleSummary(result.articleSummary);
      setSeoTitle(result.seoTitle);
      setMetaDescription(result.metaDescription);
      setUrlSlug(result.urlSlug);
      setArticleMarkdown(result.articleMarkdown);
      setArticleApproved(true);
      setImagesByAngle(imageMapFromArray(result.images as PersistedImage[]));
      setStage("article", "success", "Article approved and saved.");
      await historyQuery.refetch();
      toast.success("Article approved. You can now generate images.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Saving the article failed.");
    }
  };

  const handleGenerateSingleImage = async (angleId: number) => {
    if (!activeRunId) {
      toast.error("Generate and save an article before requesting images.");
      return;
    }

    const stageKey = `image-${angleId}` as StageKey;
    setStage(stageKey, "running", `Generating ${stageMetadata[stageKey].helper.toLowerCase()}.`);

    try {
      const result = await generateImageMutation.mutateAsync({
        runId: activeRunId,
        angleId,
        mascotEnabled,
        angleNote: angleNotes[angleId - 1] || undefined,
        revisionNote: revisionNotes[angleId - 1] || undefined,
      });

      const allImages = result.allImages as PersistedImage[];
      setImagesByAngle(imageMapFromArray(allImages));
      setStage(stageKey, "success", `${stageMetadata[stageKey].helper} ready.`);
      await historyQuery.refetch();
      toast.success(`${stageMetadata[stageKey].label} generated.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Image generation failed.";
      setStage(stageKey, "error", message);
      toast.error(message);
      throw error;
    }
  };

  const handleGenerateAllImages = async () => {
    if (!activeRunId) {
      toast.error("Approve the article before generating images.");
      return;
    }

    for (const angle of angleDefinitions) {
      try {
        await handleGenerateSingleImage(angle.id);
      } catch {
        break;
      }
    }
  };

  const handleShareRun = async (run: PersistedRun) => {
    try {
      const result = await shareRunMutation.mutateAsync({
        runId: run.id,
        origin: window.location.origin,
      });
      await navigator.clipboard.writeText(result.shareUrl);
      setCopiedShareRunId(run.id);
      window.setTimeout(() => {
        setCopiedShareRunId(current => (current === run.id ? null : current));
      }, 2500);
      await historyQuery.refetch();
      toast.success("Share link copied. You can send it to anyone who should view this run.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Creating the share link failed.");
    }
  };

  const activeRun = activeRunId ? history.find(run => run.id === activeRunId) : undefined;

  return (
    <DashboardLayout>
      <div className="mx-auto flex max-w-[1580px] flex-col gap-6">
        <section id="prompt-settings">
          <Card className="rounded-[32px] border-border/70 bg-card/90 shadow-[0_24px_70px_rgba(92,78,197,0.08)]">
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-xl tracking-tight">Prompt settings</CardTitle>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    Edit the article master prompt here, save it as your default, or use a one-off variation for the next run without exposing anything to the browser runtime.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={`rounded-full px-3 py-1 ${hasSavedPrompt ? "bg-emerald-500/10 text-emerald-600" : "bg-muted text-muted-foreground"}`}>
                    {hasSavedPrompt ? "Saved default active" : "Bundled default active"}
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <Label>Prompt mode for the next run</Label>
                <div className="grid gap-3 md:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setPromptMode("saved")}
                    disabled={!hasSavedPrompt}
                    className={`rounded-[24px] border px-4 py-4 text-left transition ${promptMode === "saved" ? "border-primary bg-primary/8 shadow-[0_10px_30px_rgba(92,78,197,0.10)]" : "border-border/70 bg-background/70"} ${!hasSavedPrompt ? "cursor-not-allowed opacity-55" : "hover:border-primary/40"}`}
                  >
                    <p className="text-sm font-medium text-foreground">Use saved default prompt</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {hasSavedPrompt ? "The next run uses your saved server-side default prompt exactly as stored." : "Save a prompt first to enable this mode."}
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPromptMode("override")}
                    className={`rounded-[24px] border px-4 py-4 text-left transition ${promptMode === "override" ? "border-primary bg-primary/8 shadow-[0_10px_30px_rgba(92,78,197,0.10)]" : "border-border/70 bg-background/70 hover:border-primary/40"}`}
                  >
                    <p className="text-sm font-medium text-foreground">Use one-time prompt override</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      The next run uses the text currently in the editor without changing your saved default unless you press save.
                    </p>
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="masterPrompt">Master prompt editor</Label>
                <Textarea
                  id="masterPrompt"
                  value={promptEditor}
                  onChange={event => {
                    setPromptEditor(event.target.value);
                    setPromptMode("override");
                  }}
                  placeholder="Your server-side master prompt will appear here."
                  className="min-h-[280px] rounded-[24px] border-border/70 bg-background/80 px-4 py-3 text-sm leading-6"
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/70 bg-muted/30 px-4 py-3">
                <p className="text-xs leading-5 text-muted-foreground">
                  {promptMode === "saved"
                    ? "The next article run will use your saved server-side default prompt. Save any edits first if you want those changes included."
                    : "The next article run will use the current editor text as a one-time override. Save it if you want this version to become your reusable default prompt."}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    className="rounded-xl"
                    onClick={handleResetPromptToBundled}
                    disabled={!bundledPrompt || savePromptMutation.isPending}
                  >
                    Reset to bundled default
                  </Button>
                  <Button
                    className="rounded-xl"
                    onClick={() => void handleSavePromptSettings()}
                    disabled={savePromptMutation.isPending || promptEditor.trim().length < 50}
                  >
                    {savePromptMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <BadgeCheck className="mr-2 h-4 w-4" />}
                    Save as default
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        <section id="workflow" className="grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
          <Card className="overflow-hidden rounded-[32px] border-border/70 bg-card/90 shadow-[0_30px_80px_rgba(92,78,197,0.12)] backdrop-blur">
            <CardContent className="p-0">
              <div className="grid gap-0 md:grid-cols-[1.3fr_0.7fr]">
                <div className="p-8 md:p-10">
                  <Badge className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-primary">Mocko daily workflow</Badge>
                  <h1 className="mt-5 max-w-2xl text-4xl font-semibold tracking-tight text-foreground md:text-5xl">
                    Secure topic-to-content generation with article review and branded image production.
                  </h1>
                  <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground">
                    Generate the article on the server, refine it in-place, then produce three polished Gemini images without ever exposing your API keys in the browser.
                  </p>
                  <div className="mt-8 grid gap-4 sm:grid-cols-3">
                    <StatCard icon={Bot} label="Article engine" value="Claude" detail="Server-side only" />
                    <StatCard icon={ImageIcon} label="Image engine" value="Gemini" detail="3 branded angles" />
                    <StatCard icon={History} label="Saved history" value={history.length.toString()} detail="Runs stored in DB" />
                  </div>
                </div>
                <div className="border-l border-border/60 bg-[linear-gradient(180deg,rgba(122,104,255,0.08),rgba(255,255,255,0))] p-8 md:p-10">
                  <div className="rounded-[28px] border border-primary/10 bg-background/80 p-6 shadow-inner">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Progress</p>
                        <p className="mt-2 text-2xl font-semibold tracking-tight">{progressValue}%</p>
                      </div>
                      <div className="rounded-2xl bg-primary/10 p-3 text-primary">
                        <WandSparkles className="h-6 w-6" />
                      </div>
                    </div>
                    <Progress value={progressValue} className="mt-5 h-2.5" />
                    <div className="mt-6 space-y-3">
                      {(Object.keys(stageMetadata) as StageKey[]).map(stageKey => (
                        <div key={stageKey} className="flex items-start gap-3 rounded-2xl border border-border/70 bg-card/70 px-4 py-3">
                          <StageIcon state={stages[stageKey].state} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-sm font-medium text-foreground">{stageMetadata[stageKey].label}</p>
                              <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${stageTone(stages[stageKey].state)}`}>
                                {stages[stageKey].state}
                              </span>
                            </div>
                            <p className="mt-1 text-xs leading-5 text-muted-foreground">
                              {stages[stageKey].message || stageMetadata[stageKey].helper}
                            </p>
                            {stages[stageKey].state === "error" ? (
                              <Button
                                variant="outline"
                                size="sm"
                                className="mt-3 rounded-xl"
                                onClick={() => {
                                  if (stageKey === "article") {
                                    void handleGenerateArticle();
                                  } else {
                                    const angleId = Number(stageKey.replace("image-", ""));
                                    void handleGenerateSingleImage(angleId);
                                  }
                                }}
                              >
                                Retry stage
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-[32px] border-border/70 bg-card/90 shadow-[0_24px_70px_rgba(92,78,197,0.10)]">
            <CardHeader className="pb-2">
              <CardTitle className="text-xl tracking-tight">New content run</CardTitle>
              <p className="text-sm leading-6 text-muted-foreground">
                Start from a topic, optionally add your main keyword, and decide whether the mascot should appear in the generated scenes.
              </p>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="topic">Topic</Label>
                <Input
                  id="topic"
                  value={topic}
                  onChange={event => setTopic(event.target.value)}
                  placeholder="How to rebook or cancel a TEF exam in Canada"
                  className="h-12 rounded-2xl"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="keyword">Primary keyword</Label>
                <Input
                  id="keyword"
                  value={primaryKeyword}
                  onChange={event => setPrimaryKeyword(event.target.value)}
                  placeholder="TEF exam cancellation"
                  className="h-12 rounded-2xl"
                />
              </div>
              <div className="flex items-center justify-between rounded-2xl border border-border/70 bg-muted/40 px-4 py-4">
                <div>
                  <p className="text-sm font-medium text-foreground">Include mascot</p>
                  <p className="text-xs leading-5 text-muted-foreground">
                    Matches the original prototype behavior by optionally placing the Mocko beaver in each generated scene.
                  </p>
                </div>
                <Switch checked={mascotEnabled} onCheckedChange={setMascotEnabled} />
              </div>
              <Button onClick={() => void handleGenerateArticle()} disabled={generateArticleMutation.isPending} className="h-12 w-full rounded-2xl">
                {generateArticleMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                Generate article
              </Button>
              <p className="text-xs leading-5 text-muted-foreground">
                The next run will use the prompt currently shown in Prompt settings. Save it if you want that version to remain your default in future sessions.
              </p>
            </CardContent>
          </Card>
        </section>

        <section id="article-review" className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <Card className="rounded-[32px] border-border/70 bg-card/90 shadow-[0_24px_70px_rgba(92,78,197,0.08)]">
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-xl tracking-tight">Article review and approval</CardTitle>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    Review the generated draft, refine the extracted fields, and approve the article before moving to image generation.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={`rounded-full px-3 py-1 ${articleApproved ? "bg-emerald-500/10 text-emerald-600" : "bg-amber-500/10 text-amber-700"}`}>
                    {articleApproved ? "Approved" : "Needs review"}
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-5 lg:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="articleTitle">Article title</Label>
                  <Input id="articleTitle" value={articleTitle} onChange={event => setArticleTitle(event.target.value)} className="h-12 rounded-2xl" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="urlSlug">URL slug</Label>
                  <Input id="urlSlug" value={urlSlug} onChange={event => setUrlSlug(event.target.value)} className="h-12 rounded-2xl" />
                </div>
              </div>
              <div className="grid gap-5 lg:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="seoTitle">SEO title</Label>
                  <Input id="seoTitle" value={seoTitle} onChange={event => setSeoTitle(event.target.value)} className="h-12 rounded-2xl" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="metaDescription">Meta description</Label>
                  <Input id="metaDescription" value={metaDescription} onChange={event => setMetaDescription(event.target.value)} className="h-12 rounded-2xl" />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="articleSummary">Image-generation summary</Label>
                <Textarea
                  id="articleSummary"
                  value={articleSummary}
                  onChange={event => setArticleSummary(event.target.value)}
                  className="min-h-[110px] rounded-3xl"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="articleMarkdown">Article markdown</Label>
                <Textarea
                  id="articleMarkdown"
                  value={articleMarkdown}
                  onChange={event => setArticleMarkdown(event.target.value)}
                  className="min-h-[420px] rounded-[28px] font-mono text-sm"
                  placeholder="The generated article will appear here."
                />
              </div>
              <div className="flex flex-wrap gap-3">
                <Button onClick={() => void handleSaveArticle()} disabled={!activeRunId || saveArticleMutation.isPending} className="h-12 rounded-2xl px-5">
                  {saveArticleMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <BadgeCheck className="mr-2 h-4 w-4" />}
                  Save and approve article
                </Button>
                <Button
                  variant="outline"
                  className="h-12 rounded-2xl px-5"
                  disabled={generateArticleMutation.isPending}
                  onClick={() => void handleGenerateArticle()}
                >
                  <RefreshCcw className="mr-2 h-4 w-4" />
                  Regenerate article
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-[32px] border-border/70 bg-card/90 shadow-[0_24px_70px_rgba(92,78,197,0.08)]">
            <CardHeader>
              <CardTitle className="text-xl tracking-tight">Rendered preview</CardTitle>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                This live preview lets you read the article as a formatted piece before committing the image-generation step.
              </p>
            </CardHeader>
            <CardContent>
              <div className="rounded-[28px] border border-border/70 bg-background/70 p-6 shadow-inner">
                <div className="prose prose-slate max-w-none prose-headings:tracking-tight prose-a:text-primary">
                  <Streamdown>{articleMarkdown || "# Your article preview\n\nGenerate an article to populate this review panel."}</Streamdown>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        <section id="image-lab" className="space-y-6">
          <Card className="rounded-[32px] border-border/70 bg-card/90 shadow-[0_24px_70px_rgba(92,78,197,0.08)]">
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <CardTitle className="text-xl tracking-tight">Image lab</CardTitle>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    Generate the three branded angles sequentially, then refine any single angle with revision notes while keeping the original prompt logic intact.
                  </p>
                </div>
                <Button onClick={() => void handleGenerateAllImages()} disabled={!activeRunId || !articleApproved || isGeneratingAny} className="h-12 rounded-2xl px-5">
                  {generateImageMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <WandSparkles className="mr-2 h-4 w-4" />}
                  Generate all 3 images
                </Button>
              </div>
            </CardHeader>
            <CardContent className="grid gap-5 xl:grid-cols-3">
              {angleDefinitions.map(angle => {
                const image = imagesByAngle[angle.id];
                const stageKey = `image-${angle.id}` as StageKey;
                const angleIndex = angle.id - 1;
                return (
                  <Card key={angle.id} className="rounded-[28px] border-border/70 bg-background/70 shadow-inner">
                    <CardHeader className="space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">Angle {angle.id}</p>
                          <CardTitle className="mt-2 text-lg tracking-tight">{angle.label}</CardTitle>
                        </div>
                        <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${stageTone(stages[stageKey].state)}`}>
                          {stages[stageKey].state}
                        </span>
                      </div>
                      <div className="aspect-[16/9] overflow-hidden rounded-[24px] border border-border/70 bg-muted/50">
                        {image?.imageUrl ? (
                          <img src={image.imageUrl} alt={angle.label} className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full items-center justify-center text-muted-foreground">
                            <div className="flex flex-col items-center gap-3 text-center">
                              <ImageIcon className="h-8 w-8" />
                              <p className="max-w-[220px] text-sm leading-6">The latest generated image for this angle will appear here.</p>
                            </div>
                          </div>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor={`angle-note-${angle.id}`}>Advanced angle note</Label>
                        <Textarea
                          id={`angle-note-${angle.id}`}
                          value={angleNotes[angleIndex]}
                          onChange={event => {
                            const next = [...angleNotes];
                            next[angleIndex] = event.target.value;
                            setAngleNotes(next);
                          }}
                          className="min-h-[96px] rounded-3xl"
                          placeholder={angle.placeholder}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={`revision-note-${angle.id}`}>Revision notes for regeneration</Label>
                        <Textarea
                          id={`revision-note-${angle.id}`}
                          value={revisionNotes[angleIndex]}
                          onChange={event => {
                            const next = [...revisionNotes];
                            next[angleIndex] = event.target.value;
                            setRevisionNotes(next);
                          }}
                          className="min-h-[96px] rounded-3xl"
                          placeholder="For example: add more books, make the setting brighter, include glasses, increase contrast."
                        />
                      </div>
                      <div className="rounded-2xl border border-border/70 bg-card/70 px-4 py-3 text-xs leading-6 text-muted-foreground">
                        {image ? (
                          <>
                            <p>
                              <strong className="text-foreground">SEO filename:</strong> {image.fileName || "n/a"}
                            </p>
                            <p>
                              <strong className="text-foreground">File size:</strong> {image.sizeBytes ? `${(image.sizeBytes / 1024).toFixed(1)} KB` : "n/a"}
                            </p>
                            <p>
                              <strong className="text-foreground">Resolution:</strong> {image.width && image.height ? `${image.width} × ${image.height}` : "n/a"}
                            </p>
                          </>
                        ) : (
                          <p>No image has been saved for this angle yet.</p>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-3">
                        <Button
                          onClick={() => void handleGenerateSingleImage(angle.id)}
                          disabled={!activeRunId || !articleApproved || isGeneratingAny}
                          className="h-11 flex-1 rounded-2xl"
                        >
                          {generateImageMutation.isPending && stages[stageKey].state === "running" ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <Sparkles className="mr-2 h-4 w-4" />
                          )}
                          {image ? "Regenerate" : "Generate"}
                        </Button>
                        {image?.imageUrl ? (
                          <Button asChild variant="outline" className="h-11 rounded-2xl px-4">
                            <a href={image.imageUrl} download={image.fileName || undefined}>
                              <Download className="mr-2 h-4 w-4" />
                              Download
                            </a>
                          </Button>
                        ) : null}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </CardContent>
          </Card>
        </section>

        <section id="history" className="grid gap-6 xl:grid-cols-[0.78fr_1.22fr]">
          <Card className="rounded-[32px] border-border/70 bg-card/90 shadow-[0_24px_70px_rgba(92,78,197,0.08)]">
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-xl tracking-tight">Generation history</CardTitle>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    Reopen prior topics, articles, and images without losing the latest saved state.
                  </p>
                </div>
                {historyQuery.isLoading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : null}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {history.length === 0 ? (
                <div className="rounded-[24px] border border-dashed border-border bg-muted/30 p-6 text-sm leading-6 text-muted-foreground">
                  Your saved runs will appear here once you generate content.
                </div>
              ) : (
                history.map(run => (
                  <div
                    key={run.id}
                    className={`rounded-[24px] border p-3 transition ${activeRunId === run.id ? "border-primary/40 bg-primary/8 shadow-md shadow-primary/10" : "border-border/70 bg-background/60 hover:bg-muted/40"}`}
                  >
                    <button onClick={() => hydrateFromRun(run)} className="w-full rounded-[20px] px-2 py-2 text-left">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-foreground">{run.articleTitle || run.topic}</p>
                          <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{run.articleSummary || run.topic}</p>
                        </div>
                        <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
                      </div>
                      <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="rounded-full bg-muted px-2.5 py-1">{formatTimestamp(run.updatedAt)}</span>
                        <span className="rounded-full bg-muted px-2.5 py-1">{run.images.length} saved images</span>
                        <span className="rounded-full bg-muted px-2.5 py-1">{run.status}</span>
                        {run.shareToken ? <Badge variant="secondary" className="rounded-full px-2.5 py-1 text-[11px]">Shared</Badge> : null}
                      </div>
                    </button>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-border/60 px-2 pt-3">
                      <p className="text-xs leading-5 text-muted-foreground">
                        {run.shareToken ? "This run already has a public share link." : "Create a public link to share this saved run with someone else."}
                      </p>
                      <Button
                        type="button"
                        variant={run.shareToken ? "outline" : "default"}
                        size="sm"
                        className="rounded-full"
                        disabled={shareRunMutation.isPending && copiedShareRunId !== run.id}
                        onClick={() => void handleShareRun(run)}
                      >
                        <Copy className="mr-2 h-4 w-4" />
                        {copiedShareRunId === run.id ? "Copied" : run.shareToken ? "Copy share link" : "Create share link"}
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card className="rounded-[32px] border-border/70 bg-card/90 shadow-[0_24px_70px_rgba(92,78,197,0.08)]">
            <CardHeader>
              <CardTitle className="text-xl tracking-tight">Active run snapshot</CardTitle>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                A quick operational view of the run you are actively editing or the most recent saved version you reopened.
              </p>
            </CardHeader>
            <CardContent>
              {activeRun ? (
                <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
                  <SnapshotTile title="Topic" value={activeRun.topic} icon={FileText} />
                  <SnapshotTile title="Keyword" value={activeRun.primaryKeyword || "None"} icon={Sparkles} />
                  <SnapshotTile title="Current stage" value={activeRun.currentStage} icon={Clock3} />
                  <SnapshotTile title="Status" value={activeRun.status} icon={CheckCircle2} />
                </div>
              ) : (
                <div className="rounded-[24px] border border-dashed border-border bg-muted/30 p-6 text-sm leading-6 text-muted-foreground">
                  Select a saved run from the history panel to inspect its metadata here.
                </div>
              )}
              <Separator className="my-6" />
              <div className="rounded-[28px] border border-border/70 bg-background/70 p-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <Bot className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">Operational notes</p>
                    <p className="text-xs leading-5 text-muted-foreground">
                      Generate the article first, save any edits, then run the image stages one by one or in sequence for clearer retries.
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>
      </div>
    </DashboardLayout>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof Sparkles;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-[24px] border border-border/70 bg-background/70 p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">{label}</p>
          <p className="mt-3 text-2xl font-semibold tracking-tight text-foreground">{value}</p>
          <p className="mt-2 text-sm text-muted-foreground">{detail}</p>
        </div>
        <div className="rounded-2xl bg-primary/10 p-3 text-primary">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

function StageIcon({ state }: { state: StageState }) {
  if (state === "running") {
    return <Loader2 className="mt-0.5 h-4 w-4 animate-spin text-primary" />;
  }
  if (state === "success") {
    return <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />;
  }
  if (state === "error") {
    return <RefreshCcw className="mt-0.5 h-4 w-4 text-destructive" />;
  }
  return <Clock3 className="mt-0.5 h-4 w-4 text-muted-foreground" />;
}

function SnapshotTile({
  title,
  value,
  icon: Icon,
}: {
  title: string;
  value: string;
  icon: typeof Sparkles;
}) {
  return (
    <div className="rounded-[24px] border border-border/70 bg-background/70 p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">{title}</p>
          <p className="mt-3 text-base font-semibold leading-7 text-foreground">{value}</p>
        </div>
        <div className="rounded-2xl bg-primary/10 p-3 text-primary">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}
