import fs from "node:fs/promises";
import path from "node:path";
import type { BriefNewsItem, CardData, RenderPayload } from "./types.js";

const INFO_LIMIT_TEXT = "信息不足，需等待更多来源确认";

export async function renderHtml(payload: RenderPayload): Promise<string[]> {
  const [template, css] = await Promise.all([
    fs.readFile(path.resolve("templates/card.html"), "utf8"),
    fs.readFile(path.resolve("styles/card.css"), "utf8")
  ]);

  return payload.cards.map((card, index) =>
    template
      .replace("/* __CARD_CSS__ */", css)
      .replace("__CARD_JSON__", JSON.stringify(toCardView(payload, card, index)).replace(/</g, "\\u003c"))
  );
}

function toCardView(payload: RenderPayload, card: CardData, index: number) {
  const pageTotal = payload.cards.length;
  const text = normalizeCardText(card);
  const publishedAtText = card.publishedAt ? formatDateTime(card.publishedAt) : "本轮无新闻";
  return {
    ...card,
    ...text,
    cardTitle: card.titleZh,
    sourceLine: card.type === "brief" ? "过去2小时短新闻精选" : "",
    page: `${index + 1}/${pageTotal}`,
    pageIndex: index + 1,
    pageTotal,
    range: `${formatDateTime(payload.rangeStart)} - ${formatDateTime(payload.rangeEnd)}`,
    generatedAt: formatDateTime(payload.generatedAt),
    publishedAtText,
    shortUrl: card.type === "brief" ? "多条原文见 cards.json" : card.url ? shortUrl(card.url) : "无原文链接",
    items: card.type === "brief" ? normalizeBriefItems(card.items) : [],
    accent: pickAccent(card.category)
  };
}

function normalizeCardText(card: CardData) {
  const keyPoints = dedupeTextItems(card.keyPoints ?? []).slice(0, 8);
  const usedKeys = new Set(keyPoints.map(toCompareKey));
  const whyItMatters = dedupeTextItems(card.whyItMatters ?? [], usedKeys).slice(0, 3);
  const declaredLimit = String(card.informationLimit ?? "").trim();
  const hasLimitInItems = [...(card.keyPoints ?? []), ...(card.whyItMatters ?? [])].some(isInfoLimitSentence);
  const informationLimit = (declaredLimit || hasLimitInItems) ? INFO_LIMIT_TEXT : "";

  return {
    keyPoints,
    whyItMatters,
    informationLimit
  };
}

function normalizeBriefItems(items: BriefNewsItem[]) {
  const usedKeys = new Set<string>();
  return items.map((item) => normalizeBriefItem(item, items.length, usedKeys));
}

function normalizeBriefItem(item: BriefNewsItem, itemCount: number, cardUsedKeys: Set<string>) {
  const pointLimit = itemCount === 1 ? 5 : itemCount === 2 ? 3 : 2;
  cardUsedKeys.add(toCompareKey(item.titleZh));
  cardUsedKeys.add(toCompareKey(item.originalTitle));
  const keyPoints = normalizeBriefKeyPoints(item, pointLimit, cardUsedKeys);
  const usedKeys = new Set([item.titleZh, item.originalTitle, ...keyPoints].map(toCompareKey));
  const whyItMatters = itemCount === 1 ? dedupeTextItems(item.whyItMatters ?? [], usedKeys).slice(0, 2) : [];
  const declaredLimit = String(item.informationLimit ?? "").trim();
  const hasLimitInItems = (item.keyPoints ?? []).some(isInfoLimitSentence);
  return {
    ...item,
    keyPoints,
    whyItMatters,
    informationLimit: (declaredLimit || hasLimitInItems) ? INFO_LIMIT_TEXT : "",
    publishedAtText: item.publishedAt ? formatDateTime(item.publishedAt) : "",
    shortUrl: item.url ? shortUrl(item.url) : "无原文链接"
  };
}

function normalizeBriefKeyPoints(item: BriefNewsItem, limit: number, cardUsedKeys: Set<string>): string[] {
  const titleKeys = new Set([item.titleZh, item.originalTitle].map(toCompareKey));
  const points = dedupeTextItems(item.keyPoints ?? [])
    .filter((point) => !titleKeys.has(toCompareKey(point)))
    .filter((point) => !isMetadataPoint(point))
    .filter((point) => {
      const key = toCompareKey(point);
      if (cardUsedKeys.has(key)) return false;
      cardUsedKeys.add(key);
      return true;
    });

  if (points.length === 0 && item.rssSummary && !titleKeys.has(toCompareKey(item.rssSummary))) {
    const key = toCompareKey(item.rssSummary);
    if (!cardUsedKeys.has(key)) {
      points.push(item.rssSummary);
      cardUsedKeys.add(key);
    }
  }

  return points.slice(0, limit);
}

function isMetadataPoint(value: string): boolean {
  return /^(来源媒体|来源|发布时间|原文链接|原文)/.test(value.trim());
}

function dedupeTextItems(values: unknown[], existingKeys = new Set<string>()): string[] {
  const seen = new Set(existingKeys);
  const result: string[] = [];
  for (const value of values) {
    const text = String(value ?? "").replace(/\s+/g, " ").trim();
    if (!text || isInfoLimitSentence(text)) continue;
    const key = toCompareKey(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

function isInfoLimitSentence(value: unknown): boolean {
  const normalized = String(value ?? "").replace(/[，,。.!！?？\s]/g, "");
  return normalized.includes(INFO_LIMIT_TEXT.replace(/[，,。.!！?？\s]/g, ""));
}

function toCompareKey(value: string): string {
  return value.replace(/[，,。.!！?？；;：:\s]/g, "").toLowerCase();
}

function pickAccent(category: string) {
  const accents: Record<string, { main: string; secondary: string }> = {
    AI: { main: "#4aa3ff", secondary: "#32d3ff" },
    芯片: { main: "#a86bff", secondary: "#6e7bff" },
    公司: { main: "#28f5a6", secondary: "#78ffd6" },
    市场: { main: "#f6c453", secondary: "#ffe08a" },
    国际: { main: "#32d3ff", secondary: "#28f5a6" },
    政策: { main: "#ff9b45", secondary: "#ffd166" },
    科研: { main: "#6e7bff", secondary: "#a86bff" },
    其他: { main: "#8ea0bc", secondary: "#b8c4d8" },
    提示: { main: "#8ea0bc", secondary: "#b8c4d8" }
  };
  return accents[category] ?? accents.其他;
}

function formatDateTime(value: string): string {
  if (!value) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai"
  }).format(new Date(value));
}

function shortUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.hostname}${url.pathname === "/" ? "" : url.pathname}`.slice(0, 54);
  } catch {
    return value.slice(0, 54);
  }
}
