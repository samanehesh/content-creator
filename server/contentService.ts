import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import axios from "axios";
import sharp from "sharp";
import { z } from "zod";
import { storagePut } from "./storage";

const ParsedArticleSchema = z.object({
  articleTitle: z.string().min(5),
  seoTitle: z.string().min(5),
  metaDescription: z.string().min(20),
  urlSlug: z.string().min(3),
  articleSummary: z.string().min(20),
  articleMarkdown: z.string().min(200),
  internalLinksUsed: z.array(z.string()).optional(),
  bodyWordCount: z.number().int().positive().optional(),
});

type ParsedArticle = z.infer<typeof ParsedArticleSchema>;

const MOCKO_HOME_URL = "https://mocko.ai/";
const DEFAULT_WORD_LIMITS = {
  targetMin: 1400,
  targetMax: 1600,
  hardMax: 1700,
} as const;

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "how",
  "in",
  "into",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "their",
  "this",
  "to",
  "with",
  "your",
  "you",
  "vs",
  "exam",
  "exams",
  "test",
  "tests",
  "guide",
]);

export const IMAGE_ANGLES = [
  {
    id: 1,
    label: "Overview scene",
    direction:
      "Wide establishing overview scene. Show 2-3 characters together in a study or learning environment, with multiple floating educational icons around them. Arrange characters around a strong focal object such as a stack of books, a desk, a laptop, or a central study element.",
  },
  {
    id: 2,
    label: "Action / close-up",
    direction:
      "Medium close-up focused on a single character performing the key action from the article. Emphasize their hands, face, and the specific object they are interacting with. Keep the same pale lavender background and floating icons in the periphery but less prominent.",
  },
  {
    id: 3,
    label: "Outcome / result",
    direction:
      "Positive outcome scene showing a character looking relieved, confident, or celebrating success. Use warm lighting, a slightly brighter background, and subtle celebratory elements such as a soft glow or gentle sparkles.",
  },
] as const;

const BRAND_STYLE = `Match the exact visual style of the attached style-reference image: 3D cartoon rendering in the style of modern Pixar or Disney, with smooth matte-finish characters, rounded soft forms, slightly oversized proportions, a pastel palette, soft ambient lighting, gentle shadows, and a pale lavender background with a subtle light grid pattern. Include friendly diverse characters in casual-professional attire, studying, reading, or learning. Feature floating educational icons such as stacked oversized books, charts, calendars, glowing lightbulbs, and coffee cups rendered in the same 3D cartoon style. Palette accents: lavender purple, navy blue, mint green, warm beige or gold, and soft yellow highlights. Keep the composition clean and avoid dense label text, full sentences, captions, or interface text. Output must be a 16:9 landscape composition.`;

const MASCOT_DESC = `Include the Mocko mascot somewhere in the scene: a friendly purple beaver character with a round cartoon head, big expressive eyes, two prominent white front teeth, and lavender-purple fur, rendered in the same 3D cartoon style as the rest of the scene. Match the mascot design shown in the attached logo reference.`;

let masterPromptPromise: Promise<string> | null = null;
let brandAssetsPromise: Promise<{ logo: string; example: string }> | null = null;
let mockoBlogSitemapPromise: Promise<Array<{ url: string; path: string }>> | null = null;
const pageTitleCache = new Map<string, Promise<string>>();
const runtimeDir = dirname(fileURLToPath(import.meta.url));

export async function readRuntimeAsset(relativePath: string) {
  const normalizedRelativePath = relativePath.replace(/^\.\//, "");
  const candidates = [
    new URL(`./${normalizedRelativePath}`, import.meta.url),
    resolve(runtimeDir, normalizedRelativePath),
    resolve(runtimeDir, "..", "server", normalizedRelativePath),
    resolve(process.cwd(), "server", normalizedRelativePath),
    resolve(process.cwd(), normalizedRelativePath),
  ];

  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      return await readFile(candidate, "utf8");
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    `Unable to load runtime asset ${normalizedRelativePath}. Tried: ${candidates
      .map(candidate => candidate instanceof URL ? candidate.toString() : candidate)
      .join(", ")}. Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

export async function getBundledMasterPromptTemplate() {
  if (!masterPromptPromise) {
    masterPromptPromise = readRuntimeAsset("prompt-assets/master-prompt.escaped").then(raw => raw.trim());
  }

  return masterPromptPromise;
}

async function getBrandAssets() {
  if (!brandAssetsPromise) {
    brandAssetsPromise = Promise.all([
      readRuntimeAsset("brand-assets/logo.b64"),
      readRuntimeAsset("brand-assets/example.b64"),
    ]).then(([logo, example]) => ({ logo: logo.trim(), example: example.trim() }));
  }

  return brandAssetsPromise;
}

function getAngleDefinition(angleId: number) {
  const angle = IMAGE_ANGLES.find(item => item.id === angleId);
  if (!angle) {
    throw new Error("Unsupported image angle.");
  }

  return angle;
}

export function extractJsonObject(rawText: string) {
  const trimmed = rawText.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "");
  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");

  if (objectStart === -1 || objectEnd === -1 || objectEnd <= objectStart) {
    throw new Error("Claude did not return a valid JSON object.");
  }

  return JSON.parse(trimmed.slice(objectStart, objectEnd + 1));
}

export function stripMarkdown(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_>`~-]/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function countWords(markdown: string) {
  const plain = stripMarkdown(markdown);
  return plain.length === 0 ? 0 : plain.split(/\s+/).filter(Boolean).length;
}

export function extractMarkdownLinks(markdown: string) {
  const links = Array.from(markdown.matchAll(/\[[^\]]+\]\((https?:\/\/[^)\s]+)\)/g), match => match[1]);
  return Array.from(new Set(links.map(normalizeMockoUrl)));
}

function deriveTitleFromMarkdown(articleMarkdown: string) {
  const match = articleMarkdown.match(/^#\s+(.+)$/m);
  if (match?.[1]) {
    return match[1].trim();
  }

  const plain = stripMarkdown(articleMarkdown);
  const sentenceMatch = plain.match(/^[^.!?]{5,120}/);
  return (sentenceMatch?.[0] || "Mocko.ai article").trim();
}

function deriveSummaryFromMarkdown(articleMarkdown: string) {
  const plain = stripMarkdown(articleMarkdown);
  const sentences = plain.match(/[^.!?]+[.!?]+/g) || [plain];
  return sentences.slice(0, 3).join(" ").trim().slice(0, 420);
}

export function slugify(text: string, maxWords = 8) {
  const cleaned = text
    .toLowerCase()
    .replace(/[\'`"’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, maxWords)
    .join("-");

  return (cleaned || "mocko-image").slice(0, 80);
}

export function normalizeArticleEditorInput(input: {
  articleMarkdown: string;
  articleTitle?: string;
  articleSummary?: string;
  seoTitle?: string;
  metaDescription?: string;
  urlSlug?: string;
}) {
  const articleMarkdown = input.articleMarkdown.trim();
  const articleTitle = (input.articleTitle || deriveTitleFromMarkdown(articleMarkdown)).trim();
  const articleSummary = (input.articleSummary || deriveSummaryFromMarkdown(articleMarkdown)).trim();
  const seoTitle = (input.seoTitle || articleTitle).trim();
  const metaDescription = (input.metaDescription || articleSummary).trim().slice(0, 320);
  const urlSlug = (input.urlSlug || slugify(articleTitle)).trim();
  const normalizedMarkdown = articleMarkdown.startsWith("#") ? articleMarkdown : `# ${articleTitle}\n\n${articleMarkdown}`;

  return {
    articleTitle,
    articleSummary,
    seoTitle,
    metaDescription,
    urlSlug,
    articleMarkdown: normalizedMarkdown,
  };
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithRetry(url: string, init: RequestInit, attempts = 3) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetch(url, init);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) {
        throw error;
      }
      await sleep(500 * attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Request failed after retries.");
}

export function shouldRetryGeminiFailure(status: number, bodyText: string) {
  if ([429, 500, 502, 503, 504].includes(status)) {
    return true;
  }

  return /high demand|unavailable|temporar|overloaded|rate limit/i.test(bodyText);
}

export function getGeminiRetryDelayMs(attempt: number, retryAfterHeader?: string | null) {
  const retryAfterSeconds = Number(retryAfterHeader ?? "");
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.min(retryAfterSeconds * 1000, 20000);
  }

  return Math.min(2000 * 2 ** (attempt - 1), 20000);
}

async function callAnthropic(prompt: string) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured.");
  }

  let lastError: unknown;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await axios.post(
        "https://api.anthropic.com/v1/messages",
        {
          model: "claude-sonnet-4-6",
          max_tokens: 5000,
          messages: [{ role: "user", content: prompt }],
        },
        {
          timeout: 120000,
          headers: {
            "content-type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
        },
      );

      const payload = response.data as {
        content?: Array<{ type: string; text?: string }>;
      };
      const textPart = payload.content?.find(part => part.type === "text" && part.text)?.text;

      if (!textPart) {
        throw new Error("Claude returned no text output.");
      }

      return textPart;
    } catch (error) {
      lastError = error;
      if (attempt === 3) {
        if (axios.isAxiosError(error)) {
          const status = error.response?.status;
          const responseBody = typeof error.response?.data === "string"
            ? error.response.data
            : JSON.stringify(error.response?.data || {});
          throw new Error(
            `Claude request failed${status ? ` (${status})` : ""}: ${responseBody.slice(0, 300) || error.message}`,
          );
        }
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 750 * attempt));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Claude request failed unexpectedly.");
}

function fillPromptTemplate(promptTemplate: string, topic: string, primaryKeyword?: string) {
  return promptTemplate
    .replace(/\{\{TOPIC\}\}/g, topic)
    .replace(/\[Insert topic here\]/gi, topic)
    .replace(/\{\{PRIMARY_KEYWORD\}\}/g, primaryKeyword?.trim() || "(none — choose one that fits the topic)")
    .replace(/\[Insert keyword here\]/gi, primaryKeyword?.trim() || "(none — choose one that fits the topic)");
}

export function extractWordCountRules(promptTemplate: string) {
  const targetMatch = promptTemplate.match(/Target:\s*([\d,]+)\s*[–-]\s*([\d,]+)/i);
  const hardMaxMatch = promptTemplate.match(/Hard\s+maximum:\s*([\d,]+)/i);
  const underMatch = promptTemplate.match(/(?:under|maximum of|no more than)\s*([\d,]+)\s*words?/i);

  const targetMin = targetMatch ? Number(targetMatch[1].replace(/,/g, "")) : DEFAULT_WORD_LIMITS.targetMin;
  const targetMax = targetMatch ? Number(targetMatch[2].replace(/,/g, "")) : DEFAULT_WORD_LIMITS.targetMax;
  const hardMax = hardMaxMatch
    ? Number(hardMaxMatch[1].replace(/,/g, ""))
    : underMatch
      ? Number(underMatch[1].replace(/,/g, ""))
      : DEFAULT_WORD_LIMITS.hardMax;

  return {
    targetMin,
    targetMax,
    hardMax,
  };
}

function normalizeMockoUrl(url: string) {
  try {
    const normalized = new URL(url, MOCKO_HOME_URL);
    normalized.hash = "";
    if (normalized.pathname === "/") {
      return MOCKO_HOME_URL;
    }
    normalized.pathname = normalized.pathname.replace(/\/+$/, "") || "/";
    return normalized.toString();
  } catch {
    return url.trim();
  }
}

function tokenize(text: string) {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .replace(/https?:\/\/[^\s]+/g, " ")
        .replace(/[^a-z0-9]+/g, " ")
        .split(/\s+/)
        .map(token => token.trim())
        .filter(token => token.length >= 3 && !STOP_WORDS.has(token)),
    ),
  );
}

function scoreTokenOverlap(referenceTokens: string[], candidateText: string) {
  const haystack = new Set(tokenize(candidateText));
  let score = 0;
  for (const token of referenceTokens) {
    if (haystack.has(token)) {
      score += token.length >= 6 ? 3 : 2;
    }
  }
  return score;
}

function stripHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchText(url: string) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "MockoContentStudio/1.0 (+https://mocko.ai)",
      accept: "text/html,application/xml;q=0.9,*/*;q=0.8",
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`Request failed for ${url}: ${response.status}`);
  }

  return response.text();
}

async function getMockoBlogSitemapEntries() {
  if (!mockoBlogSitemapPromise) {
    mockoBlogSitemapPromise = fetchText("https://mocko.ai/sitemap.xml")
      .then(xml => {
        const matches = Array.from(xml.matchAll(/<loc>(.*?)<\/loc>/g), match => normalizeMockoUrl(match[1]));
        const blogUrls = matches.filter(url => url.startsWith("https://mocko.ai/blog/"));
        return Array.from(new Set(blogUrls)).map(url => ({
          url,
          path: new URL(url).pathname.replace(/^\/blog\//, ""),
        }));
      })
      .catch(error => {
        console.warn("[ContentService] Failed to load Mocko sitemap:", error);
        return [];
      });
  }

  return mockoBlogSitemapPromise;
}

async function getPageTitle(url: string) {
  if (!pageTitleCache.has(url)) {
    pageTitleCache.set(
      url,
      fetchText(url)
        .then(html => {
          const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1];
          const titleTag = html.match(/<title>([^<]+)<\/title>/i)?.[1];
          const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
          return stripHtml(ogTitle || titleTag || h1 || url);
        })
        .catch(() => url),
    );
  }

  return pageTitleCache.get(url)!;
}

async function findRelevantMockoLinks(topic: string, primaryKeyword?: string) {
  const referenceTokens = tokenize(`${topic} ${primaryKeyword || ""}`);
  const sitemapEntries = await getMockoBlogSitemapEntries();
  if (sitemapEntries.length === 0 || referenceTokens.length === 0) {
    return [] as Array<{ url: string; title: string }>;
  }

  const prelim = sitemapEntries
    .map(entry => ({
      ...entry,
      score: scoreTokenOverlap(referenceTokens, entry.path.replace(/-/g, " ")),
    }))
    .filter(entry => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 10);

  if (prelim.length === 0) {
    return [];
  }

  const withTitles = await Promise.all(
    prelim.map(async entry => ({
      url: entry.url,
      title: await getPageTitle(entry.url),
      score: entry.score,
    })),
  );

  return withTitles
    .map(entry => ({
      ...entry,
      score: entry.score + scoreTokenOverlap(referenceTokens, entry.title),
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, 3)
    .map(entry => ({ url: entry.url, title: entry.title }));
}

async function buildInternalLinkResearch(topic: string, primaryKeyword?: string) {
  const links = await findRelevantMockoLinks(topic, primaryKeyword);
  if (links.length === 0) {
    return {
      links,
      promptBlock:
        `Server-side research result: no strong contextually relevant Mocko blog posts were confidently matched for this topic. Do not invent internal blog links. You must still include one natural homepage link to ${MOCKO_HOME_URL}.`,
    };
  }

  const list = links
    .map((link, index) => `${index + 1}. ${link.title} — ${link.url}`)
    .join("\n");

  return {
    links,
    promptBlock:
      `Server-side internal link research found these relevant Mocko blog posts for this topic. Use 2-3 of these exact URLs in the article body as natural markdown links, each at most once, and also include one natural homepage link to ${MOCKO_HOME_URL}. Do not invent any additional Mocko URLs.\n${list}`,
  };
}

export function assessArticleConstraints(input: {
  articleMarkdown: string;
  linkCandidates: Array<{ url: string; title: string }>;
  wordLimits: { targetMin: number; targetMax: number; hardMax: number };
}) {
  const bodyWordCount = countWords(input.articleMarkdown);
  const markdownLinks = extractMarkdownLinks(input.articleMarkdown);
  const homepageUsed = markdownLinks.some(url => normalizeMockoUrl(url) === MOCKO_HOME_URL);
  const blogLinksUsed = markdownLinks.filter(url => url.startsWith("https://mocko.ai/blog/"));
  const uniqueBlogLinksUsed = Array.from(new Set(blogLinksUsed));
  const requiredBlogLinks = Math.min(2, input.linkCandidates.length);
  const issues: string[] = [];

  if (bodyWordCount > input.wordLimits.hardMax) {
    issues.push(
      `The article body is ${bodyWordCount} words, which exceeds the hard maximum of ${input.wordLimits.hardMax} words. Shorten it without losing substance.`,
    );
  }

  if (!homepageUsed) {
    issues.push(`Add one natural markdown link to ${MOCKO_HOME_URL} in the article body.`);
  }

  if (requiredBlogLinks > 0 && uniqueBlogLinksUsed.length < requiredBlogLinks) {
    const candidateLines = input.linkCandidates.map(link => `- ${link.title}: ${link.url}`).join("\n");
    issues.push(
      `Use at least ${requiredBlogLinks} of the researched Mocko blog URLs as natural markdown links in the article body. Available URLs:\n${candidateLines}`,
    );
  }

  return {
    bodyWordCount,
    homepageUsed,
    blogLinksUsed: uniqueBlogLinksUsed,
    issues,
  };
}

function buildArticleJsonInstruction() {
  return `Return ONLY valid JSON with this exact shape:\n{\n  "articleTitle": "H1 title of the blog article",\n  "seoTitle": "Suggested SEO title",\n  "metaDescription": "Suggested meta description",\n  "urlSlug": "seo-friendly-url-slug",\n  "articleSummary": "A concise 2-3 sentence summary that can guide image generation",\n  "articleMarkdown": "The full blog article in Markdown starting with a single H1 line and including the required markdown links",\n  "internalLinksUsed": ["https://mocko.ai/blog/example-one", "https://mocko.ai/blog/example-two", "https://mocko.ai/"],\n  "bodyWordCount": 1542\n}\nDo not use Markdown fences. Do not add commentary before or after the JSON.`;
}

function buildInitialArticlePrompt(input: {
  filledPrompt: string;
  researchBlock: string;
  wordLimits: { targetMin: number; targetMax: number; hardMax: number };
}) {
  return `${input.filledPrompt}\n\n${input.researchBlock}\n\nCritical runtime enforcement instructions:\n- The article body must stay between ${input.wordLimits.targetMin} and ${input.wordLimits.targetMax} words whenever possible.\n- The article body must never exceed ${input.wordLimits.hardMax} words.\n- Count the body words before you answer. If the article exceeds ${input.wordLimits.hardMax} words, shorten it before returning JSON.\n- The homepage link and the required researched blog links must appear inside articleMarkdown as markdown links, not just in the metadata array.\n\n${buildArticleJsonInstruction()}`;
}

function buildRevisionPrompt(input: {
  filledPrompt: string;
  researchBlock: string;
  wordLimits: { targetMin: number; targetMax: number; hardMax: number };
  currentArticle: Record<string, unknown>;
  issues: string[];
}) {
  return `${input.filledPrompt}\n\n${input.researchBlock}\n\nYour previous draft failed validation. Revise the JSON article below so it satisfies every requirement.\n\nValidation issues:\n${input.issues.map((issue, index) => `${index + 1}. ${issue}`).join("\n")}\n\nKeep the article useful and human, but fix the constraints exactly. Return only valid JSON in the same shape.\n\nCurrent JSON draft:\n${JSON.stringify(input.currentArticle, null, 2)}\n\nRemember:\n- Target ${input.wordLimits.targetMin}-${input.wordLimits.targetMax} body words when possible.\n- Hard maximum ${input.wordLimits.hardMax} body words.\n- Keep the markdown links inside articleMarkdown.\n- internalLinksUsed must list the exact Mocko URLs actually used.\n- bodyWordCount must match the final body word count.\n\n${buildArticleJsonInstruction()}`;
}

function buildMalformedResponsePrompt(input: {
  filledPrompt: string;
  researchBlock: string;
  wordLimits: { targetMin: number; targetMax: number; hardMax: number };
  rawResponse: string;
  errorMessage: string;
}) {
  return `${input.filledPrompt}\n\n${input.researchBlock}\n\nYour previous response could not be parsed as valid JSON. Fix the format and return the full article again.\n\nParsing error:\n${input.errorMessage}\n\nMalformed response to repair:\n${input.rawResponse}\n\nRequirements:\n- Return only valid JSON in the exact required shape.\n- Escape all quotes, backslashes, and newlines correctly inside JSON strings.\n- Do not wrap the JSON in markdown fences.\n- Keep the article body between ${input.wordLimits.targetMin} and ${input.wordLimits.targetMax} words when possible.\n- Never exceed ${input.wordLimits.hardMax} words.\n- Keep the required Mocko markdown links inside articleMarkdown.\n\n${buildArticleJsonInstruction()}`;
}

export function parseArticleResponse(rawText: string): ParsedArticle {
  return ParsedArticleSchema.parse(extractJsonObject(rawText));
}

export async function generateArticleFromTopic(
  topic: string,
  primaryKeyword?: string,
  promptTemplate?: string,
) {
  const masterPrompt = (promptTemplate?.trim() || (await getBundledMasterPromptTemplate())).trim();
  const filledPrompt = fillPromptTemplate(masterPrompt, topic, primaryKeyword);
  const wordLimits = extractWordCountRules(masterPrompt);
  const research = await buildInternalLinkResearch(topic, primaryKeyword);

  let rawText = await callAnthropic(
    buildInitialArticlePrompt({
      filledPrompt,
      researchBlock: research.promptBlock,
      wordLimits,
    }),
  );

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let parsed: ParsedArticle;

    try {
      parsed = parseArticleResponse(rawText);
    } catch (error) {
      if (attempt === 3) {
        throw new Error(
          `Article returned malformed JSON after retries: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      rawText = await callAnthropic(
        buildMalformedResponsePrompt({
          filledPrompt,
          researchBlock: research.promptBlock,
          wordLimits,
          rawResponse: rawText,
          errorMessage: error instanceof Error ? error.message : String(error),
        }),
      );
      continue;
    }

    const normalized = normalizeArticleEditorInput({
      articleTitle: parsed.articleTitle,
      articleSummary: parsed.articleSummary,
      seoTitle: parsed.seoTitle,
      metaDescription: parsed.metaDescription,
      urlSlug: parsed.urlSlug,
      articleMarkdown: parsed.articleMarkdown,
    });

    const assessment = assessArticleConstraints({
      articleMarkdown: normalized.articleMarkdown,
      linkCandidates: research.links,
      wordLimits,
    });

    if (assessment.issues.length === 0) {
      return normalized;
    }

    if (attempt === 3) {
      throw new Error(`Article failed validation after retries: ${assessment.issues.join(" ")}`);
    }

    rawText = await callAnthropic(
      buildRevisionPrompt({
        filledPrompt,
        researchBlock: research.promptBlock,
        wordLimits,
        currentArticle: {
          ...parsed,
          articleMarkdown: normalized.articleMarkdown,
          internalLinksUsed: parsed.internalLinksUsed || extractMarkdownLinks(normalized.articleMarkdown),
          bodyWordCount: parsed.bodyWordCount || assessment.bodyWordCount,
        },
        issues: assessment.issues,
      }),
    );
  }

  throw new Error("Article generation failed unexpectedly.");
}

function detectContextualElements(title: string, summary: string) {
  const text = `${title} ${summary}`.toLowerCase();
  const exams: string[] = [];
  if (/\btef\b/.test(text)) exams.push("TEF");
  if (/\btcf\b/.test(text)) exams.push("TCF");
  if (/\bpte\b/.test(text)) exams.push("PTE");
  if (/\bielts\b/.test(text)) exams.push("IELTS");
  if (/\bcelpip\b/.test(text)) exams.push("CELPIP");

  const countries: Array<{ name: string; cue: string }> = [];
  if (/\b(canad(a|ian)|quebec|québec|ottawa|toronto|montreal|vancouver|calgary)\b/.test(text)) {
    countries.push({
      name: "Canada",
      cue: "a Canadian flag clearly visible, plus Canadian visual cues such as a maple leaf icon, a red-and-white accent, or a subtle snowy mountain silhouette",
    });
  }
  if (/\b(australia|australian|sydney|melbourne|brisbane)\b/.test(text)) {
    countries.push({
      name: "Australia",
      cue: "an Australian flag clearly visible, plus Australian visual cues such as the Sydney Opera House silhouette, a kangaroo icon, or gum-leaf motifs",
    });
  }
  if (/\b(united kingdom|\buk\b|britain|british|london|england)\b/.test(text)) {
    countries.push({
      name: "UK",
      cue: "a Union Jack flag clearly visible, plus British visual cues such as Big Ben or a red double-decker bus icon",
    });
  }
  if (/\b(france|french|paris)\b/.test(text) && !countries.some(country => country.name === "Canada")) {
    countries.push({
      name: "France",
      cue: "a French flag clearly visible, plus a subtle Eiffel Tower silhouette or French educational visual cues",
    });
  }

  return { exams, countries };
}

export function buildImagePrompt(input: {
  angleId: number;
  articleTitle: string;
  articleSummary: string;
  angleNote?: string;
  mascotEnabled: boolean;
  revisionNote?: string;
}) {
  const angle = getAngleDefinition(input.angleId);
  const { exams, countries } = detectContextualElements(input.articleTitle, input.articleSummary);
  const extraNote = input.angleNote?.trim() ? `\nAdditional guidance: ${input.angleNote.trim()}` : "";
  const revision = input.revisionNote?.trim()
    ? `\nRevision notes for this variation: ${input.revisionNote.trim()}`
    : "";
  const mascot = input.mascotEnabled ? `\n\n${MASCOT_DESC}` : "";

  let contextual = "";
  if (exams.length > 0) {
    contextual += `\n\nContextual exam element: The article is about the ${exams.join(" / ")} exam. Include the short text "${exams[0]}" visibly on one object such as a book cover, study binder, certificate, or signpost. This is the only notable text permitted in the image.`;
  }
  if (countries.length > 0) {
    const cues = countries.map(country => `- ${country.name}: ${country.cue}`).join("\n");
    contextual += `\n\nContextual country elements: The article references ${countries.map(country => country.name).join(" and ")}. Include the following elements naturally in the scene:\n${cues}`;
  }

  return `Generate a 3D cartoon illustration for a Mocko.ai blog post. Mocko.ai is a language-exam preparation platform for learners and immigrants.\n\nArticle title: "${input.articleTitle}"\nArticle summary: ${input.articleSummary}\n\nVisual angle: ${angle.direction}${extraNote}${revision}\n\n${BRAND_STYLE}${mascot}${contextual}\n\nCritical: the output must visually match the attached style-reference image in rendering style, lighting, character design, color palette, and background treatment. Avoid full sentences, paragraphs, captions, watermark text, or interface text.`;
}

async function callGeminiImage(prompt: string) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  const { logo, example } = await getBrandAssets();

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const response = await fetchWithRetry(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                { inlineData: { mimeType: "image/jpeg", data: example } },
                { inlineData: { mimeType: "image/png", data: logo } },
              ],
            },
          ],
          generationConfig: {
            responseModalities: ["TEXT", "IMAGE"],
          },
        }),
      },
    );

    const bodyText = await response.text();
    if (!response.ok) {
      if (attempt < 5 && shouldRetryGeminiFailure(response.status, bodyText)) {
        await sleep(getGeminiRetryDelayMs(attempt, response.headers.get("retry-after")));
        continue;
      }
      throw new Error(`Gemini request failed (${response.status}): ${bodyText.slice(0, 300)}`);
    }

    const payload = JSON.parse(bodyText) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string; inlineData?: { data?: string } }> } }>;
    };

    const parts = payload.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find(part => part.inlineData?.data);
    if (!imagePart?.inlineData?.data) {
      const textPart = parts.find(part => part.text)?.text;
      throw new Error(textPart ? `Gemini returned no image: ${textPart.slice(0, 220)}` : "Gemini returned no image data.");
    }

    return Buffer.from(imagePart.inlineData.data, "base64");
  }

  throw new Error("Gemini request failed after retries.");
}

async function optimizeToWebpUnderTarget(sourceBuffer: Buffer, targetBytes = 80 * 1024) {
  const metadata = await sharp(sourceBuffer).metadata();
  const originalWidth = metadata.width || 1600;
  const scales = [1, 0.92, 0.84, 0.76, 0.68, 0.6, 0.52, 0.44, 0.36, 0.28];
  const qualities = [92, 88, 84, 80, 76, 72, 68, 64, 60, 56, 52, 48, 44, 40];

  let fallback: { buffer: Buffer; width: number; height: number; sizeBytes: number } | null = null;

  for (const scale of scales) {
    const width = Math.max(480, Math.round(originalWidth * scale));

    for (const quality of qualities) {
      const buffer = await sharp(sourceBuffer)
        .resize({ width, withoutEnlargement: true })
        .webp({ quality, effort: 4 })
        .toBuffer();

      const candidateMetadata = await sharp(buffer).metadata();
      const candidate = {
        buffer,
        width: candidateMetadata.width || width,
        height: candidateMetadata.height || metadata.height || 900,
        sizeBytes: buffer.byteLength,
      };

      fallback = candidate;
      if (candidate.sizeBytes <= targetBytes) {
        return candidate;
      }
    }
  }

  if (fallback && fallback.sizeBytes <= targetBytes) {
    return fallback;
  }

  throw new Error("The generated image could not be optimized below 80 KB.");
}

export async function generateBrandedImage(input: {
  userId: number;
  runId: number;
  angleId: number;
  articleTitle: string;
  articleSummary: string;
  angleNote?: string;
  mascotEnabled: boolean;
  revisionNote?: string;
}) {
  const angle = getAngleDefinition(input.angleId);
  const prompt = buildImagePrompt(input);
  const rawBuffer = await callGeminiImage(prompt);
  const optimized = await optimizeToWebpUnderTarget(rawBuffer);
  const fileName = `${slugify(input.articleTitle)}-${slugify(angle.label, 3)}.webp`;
  const stored = await storagePut(
    `generated-images/user-${input.userId}/run-${input.runId}/${fileName}`,
    optimized.buffer,
    "image/webp",
  );

  return {
    angleId: angle.id,
    angleLabel: angle.label,
    angleNote: input.angleNote?.trim() || null,
    revisionNote: input.revisionNote?.trim() || null,
    prompt,
    mimeType: "image/webp",
    storageKey: stored.key,
    imageUrl: stored.url,
    fileName,
    sizeBytes: optimized.sizeBytes,
    width: optimized.width,
    height: optimized.height,
  };
}
