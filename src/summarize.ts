import OpenAI from "openai";
import { cardCategories, config, getLlmConfig } from "./config.js";
import type { CardBrief, NewsItem } from "./types.js";

export async function summarizeCards(groups: Map<string, NewsItem[]>): Promise<CardBrief[]> {
  if (config.MOCK_MODE) {
    return fallbackSummaries(groups);
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

  const input = cardCategories.map((category) => ({
    category,
    news: (groups.get(category) ?? []).map((item) => ({
      title: item.title,
      source: item.source,
      publishedAt: item.publishedAt,
      summary: item.summary
    }))
  }));

  try {
    const response = await client.chat.completions.create({
      model: llm.model,
      temperature: 0.4,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "你是中文科技与财经新闻编辑。请输出严格 JSON，不要 Markdown。"
        },
        {
          role: "user",
          content: `基于过去2小时新闻，为每个有新闻的分类生成资讯卡片文案。要求：中文、克制、信息密度高、不要编造事实。JSON 格式：{"cards":[{"category":"...","headline":"不超过24字","insight":"80字以内洞察","bullets":["每条不超过38字，3-5条"],"related":[{"title":"...","source":"...","time":"HH:mm"}]}]}。输入：${JSON.stringify(input)}`
        }
      ]
    });

    const content = response.choices[0]?.message.content ?? "{}";
    const parsed = JSON.parse(content) as { cards?: CardBrief[] };
    return normalizeCards(parsed.cards ?? [], groups);
  } catch (error) {
    throw new Error(formatLlmError(error, llm));
  }
}

function fallbackSummaries(groups: Map<string, NewsItem[]>): CardBrief[] {
  return normalizeCards(
    cardCategories.map((category) => {
      const news = groups.get(category) ?? [];
      const top = news[0];
      return {
        category,
        headline: top?.title.slice(0, 24) || `${category}暂无重点更新`,
        insight: top
          ? `过去2小时，${category}的关键变化集中在产业节奏、监管信号与市场预期的再定价。`
          : "当前时间窗内可用新闻较少，建议继续观察下一轮更新。",
        bullets: news.slice(0, 5).map((item) => item.title.slice(0, 38)),
        related: news.slice(0, 3).map((item) => ({
          title: item.title,
          source: item.source,
          time: formatTime(item.publishedAt)
        }))
      };
    }),
    groups
  );
}

function normalizeCards(cards: CardBrief[], groups: Map<string, NewsItem[]>): CardBrief[] {
  return cards
    .filter((card) => cardCategories.includes(card.category))
    .map((card) => {
      const related = card.related?.length
        ? card.related
        : (groups.get(card.category) ?? []).slice(0, 3).map((item) => ({
            title: item.title,
            source: item.source,
            time: formatTime(item.publishedAt)
          }));

      return {
        category: card.category,
        headline: card.headline || card.category,
        insight: card.insight || "本轮新闻变化仍在发酵，需结合后续事实继续观察。",
        bullets: (card.bullets ?? []).slice(0, 5),
        related: related.slice(0, 3)
      };
    })
    .filter((card) => card.bullets.length > 0 || card.related.length > 0)
    .slice(0, 5);
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
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
