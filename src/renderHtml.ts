import fs from "node:fs/promises";
import path from "node:path";
import type { CardData, RenderPayload } from "./types.js";

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
  return {
    ...card,
    ...text,
    cardTitle: card.titleZh,
    page: `${index + 1}/${pageTotal}`,
    pageIndex: index + 1,
    pageTotal,
    range: `${formatDateTime(payload.rangeStart)} - ${formatDateTime(payload.rangeEnd)}`,
    generatedAt: formatDateTime(payload.generatedAt),
    publishedAtText: card.publishedAt ? formatDateTime(card.publishedAt) : "本轮无新闻",
    shortUrl: card.url ? shortUrl(card.url) : "无原文链接",
    accent: pickAccent(index)
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

function pickAccent(index: number) {
  return [
    { main: "#28f5a6", secondary: "#4aa3ff" },
    { main: "#4aa3ff", secondary: "#a86bff" },
    { main: "#a86bff", secondary: "#28f5a6" },
    { main: "#32d3ff", secondary: "#28f5a6" },
    { main: "#b37dff", secondary: "#32d3ff" },
    { main: "#28f5a6", secondary: "#b37dff" }
  ][index % 6];
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
