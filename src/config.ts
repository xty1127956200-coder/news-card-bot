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

export const rssUrls = config.NEWS_RSS_URLS?.split(",")
  .map((url) => url.trim())
  .filter(Boolean) ?? [];

export const newsKeywords = config.NEWS_KEYWORDS.split(",")
  .map((keyword) => keyword.trim())
  .filter(Boolean);

export const cardCategories = [
  "今日主线 & 洞察",
  "AI 大模型",
  "科技前沿",
  "公司与商业",
  "市场与宏观"
] as const;

export type CardCategory = (typeof cardCategories)[number];

function envBoolean(defaultValue: boolean) {
  return z.preprocess((value) => {
    if (value === undefined || value === "") return defaultValue;
    if (typeof value === "string") return ["1", "true", "yes", "on"].includes(value.toLowerCase());
    return value;
  }, z.boolean());
}

function cleanSecret(value: string | undefined) {
  if (!value || value.startsWith("TODO_")) return undefined;
  return value;
}
