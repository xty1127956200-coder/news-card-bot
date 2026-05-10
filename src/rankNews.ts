import { cardCategories } from "./config.js";
import type { CardCategory } from "./config.js";
import type { NewsItem } from "./types.js";

const categoryKeywords: Record<CardCategory, string[]> = {
  "今日主线 & 洞察": ["监管", "政策", "趋势", "治理", "主线", "影响"],
  "AI 大模型": ["AI", "人工智能", "大模型", "模型", "OpenAI", "推理", "多模态", "Copilot"],
  "科技前沿": ["芯片", "端侧", "数据中心", "液冷", "视频理解", "机器人", "算力"],
  "公司与商业": ["公司", "企业", "微软", "苹果", "英伟达", "融资", "收入", "套餐"],
  "市场与宏观": ["市场", "宏观", "美联储", "降息", "A 股", "盘前", "资金", "板块"]
};

const importanceKeywords = ["发布", "监管", "降息", "芯片", "资本开支", "刷新", "供应链", "企业级", "治理"];

export function rankNews(items: NewsItem[]): NewsItem[] {
  const unique = dedupe(items);
  return unique
    .map((item) => ({
      ...item,
      category: item.category ?? classify(item),
      score: score(item)
    }))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

export function groupTopNews(items: NewsItem[], maxPerCategory = 5): Map<CardCategory, NewsItem[]> {
  const groups = new Map<CardCategory, NewsItem[]>();
  for (const category of cardCategories) groups.set(category, []);

  for (const item of items) {
    const category = item.category ?? "今日主线 & 洞察";
    const group = groups.get(category) ?? [];
    if (group.length < maxPerCategory) group.push(item);
    groups.set(category, group);
  }

  const headlinePool = items.slice(0, maxPerCategory);
  if ((groups.get("今日主线 & 洞察")?.length ?? 0) < 3) {
    groups.set("今日主线 & 洞察", headlinePool);
  }

  return groups;
}

function dedupe(items: NewsItem[]): NewsItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = normalizeTitle(item.title);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "").slice(0, 80);
}

function classify(item: NewsItem): CardCategory {
  const text = `${item.title} ${item.summary ?? ""}`;
  let best: CardCategory = "今日主线 & 洞察";
  let bestScore = -1;
  for (const category of cardCategories) {
    const hits = categoryKeywords[category].filter((keyword) => text.includes(keyword)).length;
    if (hits > bestScore) {
      best = category;
      bestScore = hits;
    }
  }
  return best;
}

function score(item: NewsItem): number {
  const text = `${item.title} ${item.summary ?? ""}`;
  const keywordScore = importanceKeywords.reduce((sum, keyword) => sum + (text.includes(keyword) ? 10 : 0), 0);
  const sourceScore = /reuters|bloomberg|financial times|财新|证券时报|cnnbc|cnbc/i.test(item.source) ? 8 : 4;
  const recencyMinutes = (Date.now() - new Date(item.publishedAt).getTime()) / 60_000;
  return keywordScore + sourceScore + Math.max(0, 20 - recencyMinutes / 6);
}
