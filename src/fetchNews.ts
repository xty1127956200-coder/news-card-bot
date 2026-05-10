import crypto from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { subHours } from "date-fns";
import { newsKeywords, rssUrls } from "./config.js";
import type { NewsItem } from "./types.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  textNodeName: "text"
});

export async function fetchNews(now = new Date()): Promise<NewsItem[]> {
  const since = subHours(now, 2);
  const urls = rssUrls.length > 0 ? rssUrls : buildGoogleNewsUrls();
  const batches = await Promise.allSettled(urls.map(fetchRss));
  return batches
    .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
    .filter((item) => new Date(item.publishedAt) >= since && new Date(item.publishedAt) <= now);
}

function buildGoogleNewsUrls(): string[] {
  return newsKeywords.map((keyword) => {
    const query = encodeURIComponent(`${keyword} when:2h`);
    return `https://news.google.com/rss/search?q=${query}&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`;
  });
}

async function fetchRss(url: string): Promise<NewsItem[]> {
  const response = await fetch(url, {
    headers: {
      "user-agent": "news-card-bot/0.1 (+https://github.com/)"
    }
  });
  if (!response.ok) {
    throw new Error(`RSS failed ${response.status}: ${url}`);
  }

  const xml = await response.text();
  const data = parser.parse(xml);
  const channel = data.rss?.channel ?? data.feed;
  const items = normalizeArray(channel?.item ?? channel?.entry);

  return items.map((item) => {
    const title = stripHtml(getText(item.title));
    const link = getLink(item);
    const publishedAt = new Date(item.pubDate ?? item.published ?? item.updated ?? Date.now()).toISOString();
    const source = getText(item.source) || new URL(url).hostname;
    const summary = stripHtml(getText(item.description ?? item.summary ?? item.content));

    return {
      id: crypto.createHash("sha256").update(`${title}|${link}`).digest("hex"),
      title,
      url: link,
      source,
      publishedAt,
      summary
    };
  });
}

function normalizeArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function getText(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && "text" in value) {
    return String((value as { text?: unknown }).text ?? "");
  }
  return String(value);
}

function getLink(item: Record<string, unknown>): string {
  const link = item.link;
  if (typeof link === "string") return link;
  if (Array.isArray(link)) return String(link[0]?.href ?? link[0] ?? "");
  if (typeof link === "object" && link !== null && "href" in link) {
    return String((link as { href?: string }).href ?? "");
  }
  return "";
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

export function mockNews(now = new Date()): NewsItem[] {
  const minutes = [15, 24, 36, 52, 68, 83, 96, 105, 112, 118];
  const samples = [
    ["OpenAI 发布企业级多模态工作流更新，强化长上下文与工具调用稳定性", "AI 大模型", "TechCrunch"],
    ["英伟达新一代 AI 芯片供应链排产提前，云厂商资本开支预期上修", "公司与商业", "Bloomberg"],
    ["国内大模型团队集中上线推理加速方案，价格战进入推理成本阶段", "AI 大模型", "机器之心"],
    ["美联储官员释放谨慎降息信号，科技成长股盘前波动扩大", "市场与宏观", "Reuters"],
    ["苹果被曝加速端侧 AI 功能整合，隐私计算成为下一轮竞争焦点", "科技前沿", "The Verge"],
    ["全球数据中心电力需求继续上行，核能与液冷产业链受到关注", "科技前沿", "财新"],
    ["微软扩大 Copilot 企业套餐覆盖，强调安全审计与内部知识库连接", "公司与商业", "CNBC"],
    ["A 股算力板块午后走强，资金继续围绕国产替代与订单兑现交易", "市场与宏观", "证券时报"],
    ["欧洲监管机构公布 AI 治理细则草案，模型透明度和版权披露成重点", "今日主线 & 洞察", "Financial Times"],
    ["开源多模态模型刷新视频理解榜单，小参数模型效率优势扩大", "AI 大模型", "Hugging Face"]
  ];

  return samples.map(([title, category, source], index) => ({
    id: `mock-${index}`,
    title,
    url: `https://example.com/news/${index}`,
    source,
    publishedAt: new Date(now.getTime() - minutes[index] * 60_000).toISOString(),
    summary: `${title}。市场关注其对 AI 应用、算力需求和企业商业化节奏的影响。`,
    category: category as NewsItem["category"]
  }));
}
