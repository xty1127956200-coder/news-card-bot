import type { NewsCategory, NewsItem } from "./types.js";

const categoryKeywords: Record<Exclude<NewsCategory, "提示">, string[]> = {
  AI: ["AI", "人工智能", "大模型", "model", "OpenAI", "DeepSeek", "Anthropic", "Claude", "Gemini", "Llama", "xAI"],
  芯片: ["NVIDIA", "AMD", "TSMC", "台积电", "semiconductor", "chip", "GPU", "芯片", "半导体", "export controls", "chip ban"],
  市场: ["Nasdaq", "S&P 500", "美股", "科技股", "Federal Reserve", "inflation", "降息", "宏观", "market", "stocks"],
  公司: ["Microsoft", "Apple", "Google", "Meta", "Amazon", "Tesla", "SpaceX", "Elon Musk", "公司", "business"],
  政策: ["regulation", "policy", "监管", "政策", "antitrust", "ban", "export controls", "法案", "rules"],
  国际: ["global", "Europe", "China", "US", "international", "欧盟", "美国", "中国", "全球", "国际"]
};

const importanceKeywords = [
  "launch",
  "release",
  "announces",
  "发布",
  "推出",
  "regulation",
  "监管",
  "chip",
  "芯片",
  "export controls",
  "Federal Reserve",
  "NVIDIA",
  "OpenAI",
  "DeepSeek",
  "Anthropic",
  "Tesla",
  "SpaceX"
];

const highSignalSources = /reuters|bloomberg|associated press|financial times|wall street journal|cnbc|techcrunch|the verge|wired|mit technology review|财新|证券时报|澎湃|36氪/i;

export function dedupeNews(items: NewsItem[]): NewsItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = canonicalKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function rankNews(items: NewsItem[]): NewsItem[] {
  return dedupeNews(items)
    .map((item) => ({
      ...item,
      category: classify(item),
      score: score(item)
    }))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

function canonicalKey(item: NewsItem): string {
  try {
    const url = new URL(item.url);
    url.search = "";
    url.hash = "";
    return `url:${url.toString().toLowerCase()}`;
  } catch {
    return `title:${normalizeTitle(item.originalTitle)}`;
  }
}

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "").slice(0, 96);
}

function classify(item: NewsItem): Exclude<NewsCategory, "提示"> {
  const text = `${item.originalTitle} ${item.rssSummary ?? ""} ${item.sourceName}`;
  let best: Exclude<NewsCategory, "提示"> = "国际";
  let bestScore = -1;
  for (const [category, keywords] of Object.entries(categoryKeywords) as Array<[Exclude<NewsCategory, "提示">, string[]]>) {
    const hits = keywords.filter((keyword) => text.toLowerCase().includes(keyword.toLowerCase())).length;
    if (hits > bestScore) {
      best = category;
      bestScore = hits;
    }
  }
  return best;
}

function score(item: NewsItem): number {
  const text = `${item.originalTitle} ${item.rssSummary ?? ""}`;
  const keywordScore = importanceKeywords.reduce((sum, keyword) => sum + (text.toLowerCase().includes(keyword.toLowerCase()) ? 10 : 0), 0);
  const sourceScore = highSignalSources.test(item.sourceName) ? 14 : 6;
  const recencyMinutes = (Date.now() - new Date(item.publishedAt).getTime()) / 60_000;
  return keywordScore + sourceScore + Math.max(0, 24 - recencyMinutes / 5);
}
