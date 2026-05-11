import type { NewsItem } from "./types.js";

const TITLE_SIMILARITY_THRESHOLD = 0.78;
const TOKEN_SIMILARITY_THRESHOLD = 0.82;

export type DuplicateNewsGroup = {
  kept: NewsItem;
  duplicates: Array<{
    item: NewsItem;
    reason: string;
    similarity?: number;
  }>;
};

export type DedupeNewsResult = {
  items: NewsItem[];
  duplicateGroups: DuplicateNewsGroup[];
};

export function dedupeSimilarNews(items: NewsItem[]): DedupeNewsResult {
  const groups: DuplicateNewsGroup[] = [];
  const keptItems: NewsItem[] = [];

  for (const item of items) {
    const duplicate = findDuplicateGroup(groups, keptItems, item);
    if (!duplicate) {
      keptItems.push(item);
      continue;
    }

    const { keptIndex, reason, similarity } = duplicate;
    const currentKept = keptItems[keptIndex];
    const better = pickBetterNews(currentKept, item);
    const duplicateItem = better === item ? currentKept : item;

    if (better === item) {
      keptItems[keptIndex] = item;
    }

    const group = findOrCreateGroup(groups, better === item ? item : currentKept);
    if (better === item) {
      group.kept = item;
    }
    group.duplicates.push({
      item: duplicateItem,
      reason,
      similarity
    });
  }

  return {
    items: keptItems,
    duplicateGroups: groups.filter((group) => group.duplicates.length > 0)
  };
}

function findDuplicateGroup(
  groups: DuplicateNewsGroup[],
  keptItems: NewsItem[],
  item: NewsItem
): { keptIndex: number; reason: string; similarity?: number } | null {
  for (let index = 0; index < keptItems.length; index += 1) {
    const kept = keptItems[index];
    const result = duplicateReason(kept, item);
    if (result) {
      findOrCreateGroup(groups, kept);
      return {
        keptIndex: index,
        ...result
      };
    }
  }
  return null;
}

function duplicateReason(a: NewsItem, b: NewsItem): { reason: string; similarity?: number } | null {
  if (canonicalUrl(a.url) === canonicalUrl(b.url)) return { reason: "same-url" };

  const guidA = normalizeIdentifier(a.guid);
  const guidB = normalizeIdentifier(b.guid);
  if (guidA && guidB && guidA === guidB) return { reason: "same-guid" };

  const titleA = normalizeTitle(a.originalTitle, a.sourceName);
  const titleB = normalizeTitle(b.originalTitle, b.sourceName);
  if (titleA && titleB && titleA === titleB) return { reason: "same-normalized-title", similarity: 1 };

  const tokenSimilarity = jaccard(titleTokens(titleA), titleTokens(titleB));
  if (tokenSimilarity >= TOKEN_SIMILARITY_THRESHOLD) {
    return { reason: "token-title-similarity", similarity: round(tokenSimilarity) };
  }

  const ngramSimilarity = jaccard(ngrams(titleA, hasCjk(titleA) || hasCjk(titleB) ? 2 : 3), ngrams(titleB, hasCjk(titleA) || hasCjk(titleB) ? 2 : 3));
  if (ngramSimilarity >= TITLE_SIMILARITY_THRESHOLD) {
    return { reason: "ngram-title-similarity", similarity: round(ngramSimilarity) };
  }

  return null;
}

function pickBetterNews(a: NewsItem, b: NewsItem): NewsItem {
  const scoreA = qualityScore(a);
  const scoreB = qualityScore(b);
  if (Math.abs(scoreA - scoreB) > 3) return scoreB > scoreA ? b : a;
  return new Date(b.publishedAt).getTime() > new Date(a.publishedAt).getTime() ? b : a;
}

function qualityScore(item: NewsItem): number {
  const titleLength = countText(normalizeTitle(item.originalTitle, item.sourceName));
  const summaryLength = countText(item.rssSummary ?? "");
  return (
    (item.publishedAt ? 12 : 0) +
    sourceQuality(item.sourceName) +
    Math.min(titleLength, 120) / 6 +
    (summaryLength > 0 ? 10 : 0) +
    Math.min(summaryLength, 260) / 26
  );
}

function sourceQuality(sourceName: string): number {
  const source = sourceName.toLowerCase();
  if (/reuters|bloomberg|associated press|financial times|wall street journal|ap news|cnbc|sec|federal reserve/.test(source)) return 26;
  if (/techcrunch|the verge|wired|ars technica|mit|nasa|bbc|le monde/.test(source)) return 22;
  if (/财新|证券时报|澎湃|36氪|机器之心|量子位|晚点/.test(sourceName)) return 18;
  if (/google news|news\.google|rss/.test(source)) return 8;
  return 12;
}

function canonicalUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|yclid|mc_|spm|ref|ref_src|rss|ocid|cmpid)/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    return `${url.hostname.toLowerCase()}${url.pathname.replace(/\/$/, "")}${url.search}`.toLowerCase();
  } catch {
    return value.trim().toLowerCase();
  }
}

function normalizeIdentifier(value: string | undefined): string {
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return canonicalUrl(value);
  return value.trim().toLowerCase();
}

export function normalizeTitle(title: string, sourceName = ""): string {
  const source = escapeRegExp(sourceName.trim());
  return title
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(new RegExp(`\\s+[-|_–—]\\s+${source}$`, "i"), " ")
    .replace(/\s+[-|_–—]\s+(reuters|bloomberg|ap news|associated press|financial times|the verge|techcrunch|ars technica|bbc|le monde|cnbc|路透社|彭博社|财联社|证券时报|机器之心|量子位|36氪)$/i, " ")
    .replace(/^(breaking|update|exclusive|快讯|突发|独家)[:：]\s*/i, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleTokens(normalizedTitle: string): string[] {
  const words = normalizedTitle
    .split(/\s+/)
    .filter((token) => token.length >= 2 && !stopWords.has(token));
  if (words.length >= 3) return words;
  return ngrams(normalizedTitle.replace(/\s+/g, ""), 2);
}

function ngrams(value: string, size: number): string[] {
  const chars = [...value.replace(/\s+/g, "")];
  if (chars.length <= size) return chars.length > 0 ? [chars.join("")] : [];
  const result: string[] = [];
  for (let index = 0; index <= chars.length - size; index += 1) {
    result.push(chars.slice(index, index + size).join(""));
  }
  return result;
}

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection += 1;
  }
  return intersection / (setA.size + setB.size - intersection);
}

function hasCjk(value: string): boolean {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value);
}

function findOrCreateGroup(groups: DuplicateNewsGroup[], kept: NewsItem): DuplicateNewsGroup {
  const existing = groups.find((group) => group.kept.id === kept.id || duplicateReason(group.kept, kept));
  if (existing) return existing;
  const group = { kept, duplicates: [] };
  groups.push(group);
  return group;
}

function countText(value: string): number {
  return value.replace(/\s/g, "").length;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const stopWords = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "this",
  "that",
  "about",
  "after",
  "over",
  "into",
  "says",
  "said",
  "will",
  "has",
  "have",
  "news"
]);
