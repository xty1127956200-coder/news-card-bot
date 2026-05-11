import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  LLM_PROVIDER: z.enum(["deepseek", "openai"]).default("deepseek"),
  DEEPSEEK_API_KEY: z.string().optional(),
  DEEPSEEK_BASE_URL: z.string().url().default("https://api.deepseek.com"),
  DEEPSEEK_MODEL: z.string().default("deepseek-v4-flash"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  PUSHPLUS_TOKEN: z.string().optional(),
  MOCK_MODE: envBoolean(true),
  ENABLE_PUSH: envBoolean(false),
  NEWS_RSS_URLS: z.string().optional(),
  NEWS_KEYWORDS: z.string().default("AI,人工智能,大模型,芯片,科技,金融市场,宏观经济"),
  NEWS_LOOKBACK_HOURS: envNumber(2),
  MAX_NEWS_CARDS: envNumber(12),
  PUBLIC_BASE_URL: z.string().optional(),
  PUBLIC_OUTPUT_DIR: z.string().default("public/cards"),
  WEB_PUBLIC_CARDS_DIR: z.string().default("web/public/cards")
});

export const config = envSchema.parse(process.env);

export function getPublicBaseUrl(): string | undefined {
  const value = config.PUBLIC_BASE_URL?.trim();
  if (!value || value.startsWith("TODO_")) return undefined;
  if (!value.startsWith("https://")) return undefined;
  return value.replace(/\/$/, "");
}

export function buildPublicImageUrl(fileName: string): string | undefined {
  const baseUrl = getPublicBaseUrl();
  if (!baseUrl) return undefined;
  const parsed = new URL(baseUrl);
  const suffix = parsed.pathname.replace(/\/$/, "").endsWith("/cards") ? "" : "/cards";
  return `${baseUrl}${suffix}/${fileName}`;
}

export function getLlmConfig() {
  if (config.LLM_PROVIDER === "deepseek") {
    return {
      provider: "deepseek" as const,
      apiKey: cleanSecret(config.DEEPSEEK_API_KEY),
      baseURL: config.DEEPSEEK_BASE_URL,
      model: config.DEEPSEEK_MODEL
    };
  }

  return {
    provider: "openai" as const,
    apiKey: cleanSecret(config.OPENAI_API_KEY),
    baseURL: undefined,
    model: config.OPENAI_MODEL
  };
}

export const rssUrls = parseList(config.NEWS_RSS_URLS);

export const defaultRssUrls = [
  "https://news.google.com/rss/search?q=OpenAI&hl=zh-CN&gl=CN&ceid=CN:zh-Hans",
  "https://news.google.com/rss/search?q=DeepSeek&hl=zh-CN&gl=CN&ceid=CN:zh-Hans",
  "https://news.google.com/rss/search?q=NVIDIA&hl=zh-CN&gl=CN&ceid=CN:zh-Hans",
  "https://news.google.com/rss/search?q=Tesla&hl=zh-CN&gl=CN&ceid=CN:zh-Hans",
  "https://news.google.com/rss/search?q=Nasdaq&hl=zh-CN&gl=CN&ceid=CN:zh-Hans",
  "https://news.google.com/rss/search?q=AI%20regulation&hl=en-US&gl=US&ceid=US:en",
  "https://news.google.com/rss/search?q=OpenAI&hl=en-US&gl=US&ceid=US:en",
  "https://news.google.com/rss/search?q=NVIDIA&hl=en-US&gl=US&ceid=US:en",
  "https://news.google.com/rss/search?q=Tesla&hl=en-US&gl=US&ceid=US:en",
  "https://www.theverge.com/rss/index.xml",
  "https://techcrunch.com/feed/",
  "https://arstechnica.com/feed/",
  "https://news.mit.edu/rss/feed",
  "https://www.nasa.gov/news-release/feed/",
  "https://www.federalreserve.gov/feeds/press_all.xml",
  "https://www.sec.gov/news/pressreleases.rss",
  "http://newsrss.bbc.co.uk/rss/newsonline_uk_edition/front_page/rss.xml",
  "https://www.lemonde.fr/en/rss_full.xml"
] as const;

export const effectiveRssUrls = rssUrls.length > 0 ? rssUrls : [...defaultRssUrls];

export const cardCategories = ["AI", "芯片", "公司", "市场", "国际", "政策", "科研", "其他"] as const;

export type CardCategory = (typeof cardCategories)[number];

function envBoolean(defaultValue: boolean) {
  return z.preprocess((value) => {
    if (value === undefined || value === "") return defaultValue;
    if (typeof value === "string") return ["1", "true", "yes", "on"].includes(value.toLowerCase());
    return value;
  }, z.boolean());
}

function envNumber(defaultValue: number) {
  return z.preprocess((value) => {
    if (value === undefined || value === "") return defaultValue;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : defaultValue;
  }, z.number());
}

function parseList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function cleanSecret(value: string | undefined) {
  if (!value || value.startsWith("TODO_")) return undefined;
  return value;
}
