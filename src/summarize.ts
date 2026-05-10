import OpenAI from "openai";
import { config, getLlmConfig } from "./config.js";
import type { NewsCategory, NewsItem, SelectedNewsItem } from "./types.js";

type SummaryResponse = {
  titleZh?: string;
  keyPoints?: string[];
  whyItMatters?: string[];
  informationLimit?: string;
  category?: string;
};

const allowedCategories: Array<Exclude<NewsCategory, "提示">> = ["AI", "芯片", "市场", "公司", "政策", "国际"];
const INFO_LIMIT_TEXT = "信息不足，需等待更多来源确认";

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
          content: `请只基于这一条新闻生成中文卡片文案。每次只总结一条新闻，不允许预测、脑补、扩展背景或编造。不要把同一事实在不同字段重复表达。分类只能从 AI、芯片、市场、公司、政策、国际 中选一个。

输出严格 JSON：
{"titleZh":"","keyPoints":["","","","","","",""],"whyItMatters":["","",""],"informationLimit":"","category":""}

keyPoints 要求：
1. 优先生成 5-8 条，每条 18-38 个中文字符。
2. 每条必须是不同信息，不要重复。
3. 内容优先级：发生了什么、涉及主体、关键动作、时间或地点、数据/金额/规模/版本号等可用细节、当前进展、背景或上下文、不确定性或待确认信息。
4. 只能基于输入新闻，不允许添加输入中没有的事实、数字、公司、事件或结论。
5. 如果原始新闻信息不足，不要硬编，只生成能确认的点。

whyItMatters 要求：
1. 生成 2-3 条，只写影响、风险、趋势意义。
2. 不要重复 keyPoints 里的事实。
3. 不要写“值得关注”等空泛表述。
4. 不能添加原文没有支撑的结论。

informationLimit 要求：
1. 只有信息不足时填写“${INFO_LIMIT_TEXT}”。
2. 如果 informationLimit 已填写，不要在 keyPoints 或 whyItMatters 中重复这句话。
3. 如果信息足够，informationLimit 为空字符串。

输入新闻：${JSON.stringify({
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
    keyPoints: fallbackKeyPoints(item),
    whyItMatters: [],
    informationLimit: INFO_LIMIT_TEXT,
    score: item.score,
    rssSummary: item.rssSummary
  };
}

function normalizeSummary(item: NewsItem, parsed: SummaryResponse): SelectedNewsItem {
  const category = normalizeCategory(parsed.category || item.category);
  const rawKeyPoints = Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [];
  const rawWhyItMatters = Array.isArray(parsed.whyItMatters) ? parsed.whyItMatters : [];
  let keyPoints = dedupeSentences(rawKeyPoints).slice(0, 8);
  const usedKeys = new Set(keyPoints.map(toCompareKey));
  const whyItMatters = dedupeSentences(rawWhyItMatters, usedKeys)
    .filter((item) => !/值得关注/.test(item))
    .slice(0, 3);
  const informationLimit =
    normalizeInformationLimit(parsed.informationLimit, rawKeyPoints, rawWhyItMatters) ||
    (keyPoints.length === 0 ? INFO_LIMIT_TEXT : "");

  if (keyPoints.length === 0) {
    keyPoints = fallbackKeyPoints(item);
  }

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
    informationLimit,
    score: item.score,
    rssSummary: item.rssSummary
  };
}

function fallbackKeyPoints(item: NewsItem): string[] {
  return dedupeSentences([
    item.rssSummary || item.originalTitle,
    `来源媒体：${item.sourceName}`,
    `发布时间：${formatDateTime(item.publishedAt)}`,
    "原文链接已保留，可用于核验"
  ]);
}

function dedupeSentences(values: unknown[], existingKeys = new Set<string>()): string[] {
  const seen = new Set(existingKeys);
  const result: string[] = [];
  for (const value of values) {
    const sentence = cleanSentence(value);
    if (!sentence || isInfoLimitSentence(sentence)) continue;
    const key = toCompareKey(sentence);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(sentence);
  }
  return result;
}

function cleanSentence(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/^[\s\-•·*、.。；;:：\d()（）]+/, "")
    .trim();
}

function normalizeInformationLimit(limit: unknown, rawKeyPoints: unknown[], rawWhyItMatters: unknown[]): string {
  const allValues = [limit, ...rawKeyPoints, ...rawWhyItMatters];
  return allValues.some(isInfoLimitSentence) ? INFO_LIMIT_TEXT : "";
}

function isInfoLimitSentence(value: unknown): boolean {
  const normalized = String(value ?? "").replace(/[，,。.!！?？\s]/g, "");
  return normalized.includes(INFO_LIMIT_TEXT.replace(/[，,。.!！?？\s]/g, ""));
}

function toCompareKey(value: string): string {
  return value.replace(/[，,。.!！?？；;：:\s]/g, "").toLowerCase();
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
