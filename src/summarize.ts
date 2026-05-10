import OpenAI from "openai";
import { config, getLlmConfig } from "./config.js";
import type { NewsCategory, NewsItem, SelectedNewsItem } from "./types.js";

type SummaryResponse = {
  titleZh?: string;
  keyPoints?: string[];
  whyItMatters?: string[];
  category?: string;
};

const allowedCategories: Array<Exclude<NewsCategory, "提示">> = ["AI", "芯片", "市场", "公司", "政策", "国际"];

export async function summarizeNewsItems(items: NewsItem[]): Promise<SelectedNewsItem[]> {
  const results: SelectedNewsItem[] = [];
  for (const item of items) {
    results.push(await summarizeOneNews(item));
  }
  return results;
}

async function summarizeOneNews(item: NewsItem): Promise<SelectedNewsItem> {
  if (config.MOCK_MODE) {
    return fallbackSummary(item);
  }

  const llm = getLlmConfig();
  if (!llm.apiKey) {
    throw new Error(
      llm.provider === "deepseek"
        ? "DEEPSEEK_API_KEY is required when MOCK_MODE=false and LLM_PROVIDER=deepseek. Put it in .env or GitHub Secrets."
        : "OPENAI_API_KEY is required when MOCK_MODE=false and LLM_PROVIDER=openai. Put it in .env or GitHub Secrets."
    );
  }

  const client = new OpenAI({
    apiKey: llm.apiKey,
    baseURL: llm.baseURL
  });

  try {
    const response = await client.chat.completions.create({
      model: llm.model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "你是中文新闻编辑。你只能总结用户提供的单条 RSS 新闻字段，不允许添加输入中没有的事实、数字、公司、事件或结论。输出严格 JSON，不要 Markdown。"
        },
        {
          role: "user",
          content: `请只基于这一条新闻生成中文卡片文案。每次只总结一条新闻，不允许预测、脑补、扩展背景或编造。不要把同一事实在不同字段重复表达。若信息不足，在 keyPoints 中明确写“信息不足，需等待更多来源确认”。分类只能从 AI、芯片、市场、公司、政策、国际 中选一个。输出 JSON：{"titleZh":"","keyPoints":["","","","",""],"whyItMatters":["",""],"category":""}。要求：keyPoints 用 4-6 条短句，覆盖发生了什么、涉及主体、关键时间/动作/数据、当前进展、必要背景；whyItMatters 只写影响、风险、趋势意义，不重复 keyPoints 里的事实。输入新闻：${JSON.stringify({
            originalTitle: item.originalTitle,
            sourceName: item.sourceName,
            publishedAt: item.publishedAt,
            url: item.url,
            rssSummary: item.rssSummary ?? "",
            suggestedCategory: item.category ?? "国际"
          })}`
        }
      ]
    });

    const content = response.choices[0]?.message.content ?? "{}";
    const parsed = JSON.parse(content) as SummaryResponse;
    return normalizeSummary(item, parsed);
  } catch (error) {
    throw new Error(formatLlmError(error, llm));
  }
}

function fallbackSummary(item: NewsItem): SelectedNewsItem {
  const category = normalizeCategory(item.category);
  return {
    type: "news",
    id: item.id,
    originalTitle: item.originalTitle,
    sourceName: item.sourceName,
    publishedAt: item.publishedAt,
    url: item.url,
    fetchedAt: item.fetchedAt,
    category,
    titleZh: item.originalTitle.slice(0, 48),
    keyPoints: [
      item.rssSummary || item.originalTitle,
      `来源：${item.sourceName}`,
      `发布时间：${formatDateTime(item.publishedAt)}`,
      `原文链接已保留，可用于核验。`,
      "信息不足，需等待更多来源确认。"
    ],
    whyItMatters: ["信息不足，需等待更多来源确认。"],
    score: item.score,
    rssSummary: item.rssSummary
  };
}

function normalizeSummary(item: NewsItem, parsed: SummaryResponse): SelectedNewsItem {
  const fallback = "信息不足，需等待更多来源确认。";
  const category = normalizeCategory(parsed.category || item.category);
  const keyPoints = Array.isArray(parsed.keyPoints) ? parsed.keyPoints.filter(Boolean).slice(0, 6) : [];
  while (keyPoints.length < 4) keyPoints.push(fallback);
  const whyItMatters = Array.isArray(parsed.whyItMatters) ? parsed.whyItMatters.filter(Boolean).slice(0, 2) : [];
  if (whyItMatters.length === 0) whyItMatters.push(fallback);

  return {
    type: "news",
    id: item.id,
    originalTitle: item.originalTitle,
    sourceName: item.sourceName,
    publishedAt: item.publishedAt,
    url: item.url,
    fetchedAt: item.fetchedAt,
    category,
    titleZh: (parsed.titleZh || item.originalTitle).slice(0, 80),
    keyPoints,
    whyItMatters,
    score: item.score,
    rssSummary: item.rssSummary
  };
}

function normalizeCategory(value: unknown): Exclude<NewsCategory, "提示"> {
  return allowedCategories.includes(value as Exclude<NewsCategory, "提示">) ? (value as Exclude<NewsCategory, "提示">) : "国际";
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai"
  }).format(new Date(value));
}

function formatLlmError(error: unknown, llm: ReturnType<typeof getLlmConfig>): string {
  const err = error as {
    status?: number;
    code?: string;
    message?: string;
    error?: { message?: string; code?: string; type?: string };
  };
  const status = err.status;
  const code = err.code ?? err.error?.code;
  const message = err.error?.message ?? err.message ?? String(error);
  const prefix = `${llm.provider} API request failed`;

  if (status === 401 || /api key|authentication|unauthorized|invalid.*key/i.test(message)) {
    return `${prefix}: API Key 缺失或无效。请检查 ${llm.provider === "deepseek" ? "DEEPSEEK_API_KEY" : "OPENAI_API_KEY"}。原始错误：${message}`;
  }
  if (status === 402 || /balance|insufficient|quota|billing|余额|额度/i.test(message)) {
    return `${prefix}: 余额不足或额度不可用。请检查 ${llm.provider === "deepseek" ? "DeepSeek" : "OpenAI"} 账户余额/账单。原始错误：${message}`;
  }
  if (status === 429 || /rate limit|too many requests|限流/i.test(message)) {
    return `${prefix}: 触发 429 限流。请稍后重试，或降低 GitHub Actions 运行频率。原始错误：${message}`;
  }
  if (status === 400 && /model|模型/i.test(message)) {
    return `${prefix}: 模型名可能错误。当前模型是 "${llm.model}"，请检查 ${llm.provider === "deepseek" ? "DEEPSEEK_MODEL" : "OPENAI_MODEL"}。原始错误：${message}`;
  }
  if (status === 404 || /model.*not found|not found/i.test(message)) {
    return `${prefix}: 模型或接口地址不存在。当前 baseURL=${llm.baseURL ?? "OpenAI default"}，model=${llm.model}。原始错误：${message}`;
  }

  return `${prefix}: status=${status ?? "unknown"} code=${code ?? "unknown"} model=${llm.model} baseURL=${llm.baseURL ?? "OpenAI default"}。原始错误：${message}`;
}
