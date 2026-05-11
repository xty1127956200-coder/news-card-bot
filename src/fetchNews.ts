import crypto from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { effectiveRssUrls } from "./config.js";
import type { FetchNewsResult, NewsItem, RawNewsItem } from "./types.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  textNodeName: "text"
});

export async function fetchNews(windowStart: Date, windowEnd: Date): Promise<FetchNewsResult> {
  const fetchedAt = new Date().toISOString();
  const batches = await Promise.allSettled(effectiveRssUrls.map((url) => fetchRss(url, fetchedAt)));
  const rawNews: RawNewsItem[] = [];
  const sourceStats: FetchNewsResult["sourceStats"] = [];

  for (let index = 0; index < batches.length; index += 1) {
    const url = effectiveRssUrls[index];
    const result = batches[index];
    if (result.status === "fulfilled") {
      const recentCount = result.value.filter((item) => isWithinWindow(item.publishedAt, windowStart, windowEnd)).length;
      rawNews.push(...result.value);
      sourceStats.push({
        url,
        status: "ok",
        totalCount: result.value.length,
        recentCount
      });
    } else {
      sourceStats.push({
        url,
        status: "failed",
        totalCount: 0,
        recentCount: 0,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason)
      });
    }
  }

  const recentNews = rawNews
    .filter((item) => item.originalTitle && item.url && item.sourceName && item.publishedAt)
    .filter((item) => isWithinWindow(item.publishedAt, windowStart, windowEnd))
    .map((item) => ({
      id: item.id,
      originalTitle: item.originalTitle as string,
      sourceName: item.sourceName as string,
      publishedAt: item.publishedAt as string,
      url: item.url as string,
      fetchedAt: item.fetchedAt,
      rssUrl: item.rssUrl,
      rssTitle: item.rssTitle,
      guid: item.guid,
      rssSummary: item.summary
    }));

  return {
    rawNews,
    recentNews,
    sourceStats
  };
}

async function fetchRss(url: string, fetchedAt: string): Promise<RawNewsItem[]> {
  const response = await fetch(url, {
    headers: {
      "user-agent": "news-card-bot/0.2 (+https://github.com/)"
    }
  });
  if (!response.ok) {
    throw new Error(`RSS failed ${response.status}: ${url}`);
  }

  const xml = await response.text();
  const data = parser.parse(xml);
  const channel = data.rss?.channel ?? data.feed;
  const rssTitle = stripHtml(getText(channel?.title)) || hostName(url);
  const items = normalizeArray<Record<string, unknown>>(channel?.item ?? channel?.entry);

  return items.map((item) => {
    const originalTitle = stripHtml(getText(item.title)) || null;
    const link = normalizeUrl(getLink(item));
    const guid = getGuid(item);
    const publishedAt = parseDate(item.pubDate ?? item.published ?? item.updated ?? item["dc:date"]);
    const sourceName = stripHtml(getText(item.source) || getText(item["dc:creator"]) || rssTitle || hostName(url)) || null;
    const summary = stripHtml(getText(item.description ?? item.summary ?? item.content ?? item["content:encoded"]));
    const id = crypto.createHash("sha256").update(`${originalTitle ?? ""}|${link ?? ""}|${publishedAt ?? ""}`).digest("hex");

    return {
      id,
      originalTitle,
      sourceName,
      publishedAt,
      url: link,
      fetchedAt,
      rssUrl: url,
      rssTitle,
      guid,
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
  if (typeof value === "number") return String(value);
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    if (typeof record.text === "string") return record.text;
    if (typeof record["#text"] === "string") return record["#text"];
  }
  return "";
}

function getLink(item: Record<string, unknown>): string | null {
  const link = item.link;
  if (typeof link === "string") return link;
  if (Array.isArray(link)) {
    const first = link[0] as unknown;
    if (typeof first === "string") return first;
    if (typeof first === "object" && first !== null && "href" in first) return String((first as { href?: string }).href ?? "");
  }
  if (typeof link === "object" && link !== null && "href" in link) {
    return String((link as { href?: string }).href ?? "");
  }
  if (typeof item.guid === "string" && item.guid.startsWith("http")) return item.guid;
  return null;
}

function getGuid(item: Record<string, unknown>): string | undefined {
  const value = item.guid ?? item.id;
  const text = getText(value) || (typeof value === "string" ? value : "");
  return text.trim() || undefined;
}

function parseDate(value: unknown): string | null {
  if (!value) return null;
  const date = new Date(getText(value) || String(value));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function normalizeUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.toString();
  } catch {
    return null;
  }
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function hostName(value: string): string {
  try {
    return new URL(value).hostname;
  } catch {
    return "RSS";
  }
}

function isWithinWindow(value: string | null, windowStart: Date, windowEnd: Date): boolean {
  if (!value) return false;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && timestamp >= windowStart.getTime() && timestamp <= windowEnd.getTime();
}

export function mockNews(now = new Date()): NewsItem[] {
  const minutes = [15, 24, 36, 52, 68, 83, 96, 105, 112, 118];
  const samples = [
    ["OpenAI 发布企业级多模态工作流更新，强化长上下文与工具调用稳定性", "AI", "TechCrunch"],
    ["英伟达新一代 AI 芯片供应链排产提前，云厂商资本开支预期上修", "芯片", "Bloomberg"],
    ["国内大模型团队集中上线推理加速方案，价格战进入推理成本阶段", "AI", "机器之心"],
    ["美联储官员释放谨慎降息信号，科技成长股盘前波动扩大", "市场", "Reuters"],
    ["苹果被曝加速端侧 AI 功能整合，隐私计算成为下一轮竞争焦点", "公司", "The Verge"],
    ["欧洲监管机构公布 AI 治理细则草案，模型透明度和版权披露成重点", "政策", "Financial Times"]
  ];

  return samples.map(([originalTitle, category, sourceName], index) => ({
    id: `mock-${index}`,
    originalTitle,
    sourceName,
    publishedAt: new Date(now.getTime() - minutes[index] * 60_000).toISOString(),
    url: `https://example.com/news/${index}`,
    fetchedAt: now.toISOString(),
    rssUrl: "mock://local",
    rssTitle: "Mock RSS",
    rssSummary: `${originalTitle}。这是用于本地视觉测试的 mock 摘要。`,
    category: category as NewsItem["category"]
  }));
}
