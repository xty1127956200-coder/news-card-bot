import type { NewsItem } from "./types.js";

const TITLE_SIMILARITY_THRESHOLD = 0.76;
const TOKEN_SIMILARITY_THRESHOLD = 0.78;
const ANCHORED_TITLE_SIMILARITY_THRESHOLD = 0.62;
const CONTAINMENT_MIN_RATIO = 0.58;

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

  const anchorScore = sharedAnchorScore(a, b, titleA, titleB);
  const containmentSimilarity = containment(titleA, titleB);
  if (anchorScore >= 2 && containmentSimilarity >= CONTAINMENT_MIN_RATIO) {
    return { reason: "anchored-title-containment", similarity: round(containmentSimilarity) };
  }

  const tokenSimilarity = jaccard(titleTokens(titleA), titleTokens(titleB));
  if (tokenSimilarity >= TOKEN_SIMILARITY_THRESHOLD) {
    return { reason: "token-title-similarity", similarity: round(tokenSimilarity) };
  }

  const ngramSimilarity = titleSimilarity(titleA, titleB);
  if (ngramSimilarity >= TITLE_SIMILARITY_THRESHOLD) {
    return { reason: "ngram-title-similarity", similarity: round(ngramSimilarity) };
  }

  if (anchorScore >= 2 && ngramSimilarity >= ANCHORED_TITLE_SIMILARITY_THRESHOLD) {
    return { reason: "same-subject-action-title-similarity", similarity: round(ngramSimilarity) };
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
    .replace(/^[\s\[\(（【]*(breaking|update|updated|exclusive|live|快讯|突发|更新|独家|直播|最新)[\]\)）】\s:：-]*/gi, " ")
    .replace(/\s*[\[(（【](breaking|update|updated|exclusive|live|快讯|突发|更新|独家|直播|最新)[\])）】]\s*/gi, " ")
    .replace(new RegExp(`\\s+[-|_–—]\\s+${source}$`, "i"), " ")
    .replace(/\s+[-|_–—]\s+(reuters|bloomberg|ap news|associated press|financial times|the verge|techcrunch|ars technica|bbc|le monde|cnbc|yahoo finance|marketwatch|路透社|彭博社|财联社|证券时报|机器之心|量子位|36氪|华尔街见闻|新浪财经|腾讯新闻|网易新闻|搜狐新闻)$/i, " ")
    .replace(/\s+(via|from|source)\s+\p{L}+$/iu, " ")
    .replace(/^(breaking|update|updated|exclusive|live|快讯|突发|更新|独家|直播|最新)[:：]\s*/i, " ")
    .replace(/\b(says|said|report|reports|reported|according to|sources)\b/gi, " ")
    .replace(/\b(news|stock|stocks|shares|share|today)\b/gi, " ")
    .replace(/\b(新闻|消息|报道称|报告称|据悉|盘中|今日|股票|股价)\b/g, " ")
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

function titleSimilarity(a: string, b: string): number {
  const cjk = hasCjk(a) || hasCjk(b);
  if (!cjk) return jaccard(ngrams(a, 3), ngrams(b, 3));
  const bigram = jaccard(ngrams(a, 2), ngrams(b, 2));
  const trigram = jaccard(ngrams(a, 3), ngrams(b, 3));
  return Math.max(bigram * 0.65 + trigram * 0.35, trigram);
}

function containment(a: string, b: string): number {
  const compactA = a.replace(/\s+/g, "");
  const compactB = b.replace(/\s+/g, "");
  if (compactA.length < 8 || compactB.length < 8) return 0;
  if (compactA.includes(compactB) || compactB.includes(compactA)) {
    return Math.min(compactA.length, compactB.length) / Math.max(compactA.length, compactB.length);
  }
  return longestCommonSubstringRatio(compactA, compactB);
}

function longestCommonSubstringRatio(a: string, b: string): number {
  const charsA = [...a];
  const charsB = [...b];
  const previous = new Array(charsB.length + 1).fill(0);
  let best = 0;
  for (let i = 1; i <= charsA.length; i += 1) {
    for (let j = charsB.length; j >= 1; j -= 1) {
      if (charsA[i - 1] === charsB[j - 1]) {
        previous[j] = previous[j - 1] + 1;
        best = Math.max(best, previous[j]);
      } else {
        previous[j] = 0;
      }
    }
  }
  return best / Math.max(charsA.length, charsB.length);
}

function sharedAnchorScore(a: NewsItem, b: NewsItem, titleA: string, titleB: string): number {
  const entitiesA = extractEntities(`${titleA} ${a.rssSummary ?? ""}`);
  const entitiesB = extractEntities(`${titleB} ${b.rssSummary ?? ""}`);
  const actionsA = extractActions(titleA);
  const actionsB = extractActions(titleB);
  const sharedEntities = overlapCount(entitiesA, entitiesB);
  const sharedActions = overlapCount(actionsA, actionsB);
  if (sharedEntities === 0) return 0;
  return sharedEntities + sharedActions;
}

function extractEntities(value: string): Set<string> {
  const normalized = value.toLowerCase();
  const entities = new Set<string>();
  for (const entity of knownEntities) {
    if (normalized.includes(entity.toLowerCase())) entities.add(entity.toLowerCase());
  }
  const englishEntities = value.match(/\b[A-Z][A-Za-z0-9&.-]{1,}(?:\s+[A-Z][A-Za-z0-9&.-]{1,}){0,2}\b/g) ?? [];
  for (const entity of englishEntities) {
    const key = entity.toLowerCase();
    if (!stopWords.has(key) && key.length >= 3) entities.add(key);
  }
  const chineseEntities = value.match(/[\p{Script=Han}]{2,8}(公司|集团|银行|交易所|监管|委员会|法院|政府|部门|团队|机构|大学|研究院)/gu) ?? [];
  for (const entity of chineseEntities) entities.add(entity.toLowerCase());
  return entities;
}

function extractActions(value: string): Set<string> {
  const normalized = value.toLowerCase();
  const actions = new Set<string>();
  for (const [name, patterns] of Object.entries(actionPatterns)) {
    if (patterns.some((pattern) => pattern.test(normalized))) actions.add(name);
  }
  return actions;
}

function overlapCount<T>(a: Set<T>, b: Set<T>): number {
  let count = 0;
  for (const item of a) {
    if (b.has(item)) count += 1;
  }
  return count;
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

const knownEntities = [
  "OpenAI",
  "DeepSeek",
  "Anthropic",
  "Claude",
  "Gemini",
  "Google",
  "Microsoft",
  "Apple",
  "Meta",
  "Amazon",
  "NVIDIA",
  "AMD",
  "TSMC",
  "Tesla",
  "SpaceX",
  "xAI",
  "Nasdaq",
  "S&P 500",
  "Federal Reserve",
  "SEC",
  "欧盟",
  "美国",
  "中国",
  "台积电",
  "英伟达",
  "微软",
  "苹果",
  "谷歌",
  "特斯拉",
  "美联储",
  "证监会"
];

const actionPatterns: Record<string, RegExp[]> = {
  launch: [/launch|release|roll out|推出|发布|上线|推出|发布|亮相/],
  update: [/update|upgrade|更新|升级|改进|增强/],
  regulate: [/regulat|rule|policy|ban|probe|investigat|监管|规定|政策|禁令|调查|审查/],
  finance: [/earnings|revenue|profit|funding|raise|ipo|stock|shares|财报|营收|利润|融资|上市|股价|股票/],
  partnership: [/partner|deal|agreement|collaborat|合作|协议|交易|签署/],
  chip: [/chip|gpu|semiconductor|wafer|foundry|芯片|半导体|晶圆|代工|gpu/],
  model: [/model|llm|agent|reasoning|benchmark|大模型|模型|智能体|推理|基准/],
  legal: [/lawsuit|court|appeal|settlement|sue|起诉|法院|诉讼|和解|裁定/],
  market: [/market|nasdaq|index|inflation|rate cut|市场|纳指|指数|通胀|降息|加息/]
};
