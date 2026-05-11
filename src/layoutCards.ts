import type { BriefNewsCard, CardData, NewsCategory, SelectedNewsItem, SingleNewsCard } from "./types.js";

type RankedNews = {
  news: SelectedNewsItem;
  rankIndex: number;
  level: "sufficient" | "short";
};

type CardUnit =
  | {
      type: "single";
      sortIndex: number;
      category: Exclude<NewsCategory, "提示">;
      news: SelectedNewsItem;
    }
  | {
      type: "brief";
      sortIndex: number;
      category: Exclude<NewsCategory, "提示">;
      items: SelectedNewsItem[];
    };

const categoryOrder: Array<Exclude<NewsCategory, "提示">> = ["AI", "芯片", "公司", "市场", "国际", "政策", "科研", "其他"];

export type LayoutResult = {
  cards: CardData[];
  selectedNews: SelectedNewsItem[];
  stats: {
    sufficientNewsCount: number;
    shortNewsCount: number;
    singleCardCount: number;
    briefCardCount: number;
    finalImageCount: number;
    cardSummaries: Array<{
      cardId: string;
      type: "single" | "brief" | "empty-state";
      title: string;
      category: string;
      itemCount: number;
    }>;
  };
};

export function layoutCards(items: SelectedNewsItem[], maxCards: number): LayoutResult {
  const ranked = items.map((news, rankIndex) => ({
    news,
    rankIndex,
    level: isInformationSufficient(news) ? "sufficient" as const : "short" as const
  }));

  const sufficient = ranked.filter((item) => item.level === "sufficient");
  const short = ranked.filter((item) => item.level === "short");
  const units = [...sufficient.map(toSingleUnit), ...createBriefUnits(short)]
    .sort(compareCardUnits)
    .slice(0, maxCards);

  const cards: CardData[] = [];
  const selectedNews: SelectedNewsItem[] = [];

  units.forEach((unit, index) => {
    const cardId = `card-${index + 1}`;
    if (unit.type === "single") {
      const news = markSelectedNews(unit.news, cardId, "single", 1);
      selectedNews.push(news);
      cards.push(toSingleCard(news));
      return;
    }

    const markedItems = unit.items.map((item, itemIndex) => markSelectedNews(item, cardId, "brief", itemIndex + 1));
    selectedNews.push(...markedItems);
    cards.push(toBriefCard(cardId, unit.category, markedItems));
  });

  const singleCardCount = cards.filter((card) => card.type === "single").length;
  const briefCardCount = cards.filter((card) => card.type === "brief").length;

  return {
    cards,
    selectedNews,
    stats: {
      sufficientNewsCount: sufficient.length,
      shortNewsCount: short.length,
      singleCardCount,
      briefCardCount,
      finalImageCount: cards.length,
      cardSummaries: cards.map((card) => ({
        cardId: "cardId" in card ? card.cardId : "empty-state",
        type: card.type,
        title: card.titleZh,
        category: card.category,
        itemCount: card.type === "brief" ? card.items.length : 1
      }))
    }
  };
}

function isInformationSufficient(item: SelectedNewsItem): boolean {
  if (item.informationLimit) return false;
  const keyPoints = item.keyPoints.filter(Boolean);
  const keyPointChars = countText(keyPoints.join(""));
  const totalChars = countText([item.titleZh, ...keyPoints, ...item.whyItMatters].join(""));
  if (keyPoints.length <= 4 || keyPointChars < 140) return false;
  if (keyPoints.length >= 7 || keyPointChars >= 180) return true;
  return totalChars >= 240;
}

function toSingleUnit(item: RankedNews): CardUnit {
  return {
    type: "single",
    sortIndex: item.rankIndex,
    category: item.news.category,
    news: item.news
  };
}

function createBriefUnits(items: RankedNews[]): CardUnit[] {
  const grouped = new Map<Exclude<NewsCategory, "提示">, RankedNews[]>();
  for (const item of items) {
    grouped.set(item.news.category, [...(grouped.get(item.news.category) ?? []), item]);
  }

  const units: CardUnit[] = [];
  for (const [category, group] of grouped.entries()) {
    const sorted = group.sort((a, b) => a.rankIndex - b.rankIndex);
    for (let index = 0; index < sorted.length; index += 3) {
      const chunk = sorted.slice(index, index + 3);
      units.push({
        type: "brief",
        sortIndex: Math.min(...chunk.map((item) => item.rankIndex)),
        category,
        items: chunk.map((item) => item.news)
      });
    }
  }
  return units;
}

function compareCardUnits(a: CardUnit, b: CardUnit): number {
  return (
    categoryRank(a.category) - categoryRank(b.category) ||
    unitTypeRank(a) - unitTypeRank(b) ||
    a.sortIndex - b.sortIndex
  );
}

function categoryRank(category: Exclude<NewsCategory, "提示">): number {
  const index = categoryOrder.indexOf(category);
  return index === -1 ? categoryOrder.length : index;
}

function unitTypeRank(unit: CardUnit): number {
  if (unit.type === "single") return 0;
  if (unit.items.length === 3) return 1;
  if (unit.items.length === 2) return 2;
  return 3;
}

function markSelectedNews(
  item: SelectedNewsItem,
  cardId: string,
  cardType: "single" | "brief",
  cardItemIndex: number
): SelectedNewsItem {
  return {
    ...item,
    cardId,
    cardType,
    cardItemIndex
  };
}

function toSingleCard(item: SelectedNewsItem): SingleNewsCard {
  return {
    ...item,
    type: "single",
    cardId: item.cardId ?? "card-1",
    cardType: "single"
  };
}

function toBriefCard(
  cardId: string,
  category: Exclude<NewsCategory, "提示">,
  items: SelectedNewsItem[]
): BriefNewsCard {
  const sortedByTime = [...items].sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
  const sources = [...new Set(items.map((item) => item.sourceName).filter(Boolean))];
  const sourceName = sources.length <= 2 ? sources.join(" / ") : `${sources.length}个来源`;

  return {
    type: "brief",
    cardId,
    cardType: "brief",
    category,
    titleZh: `${category} 快讯`,
    keyPoints: [],
    whyItMatters: [],
    informationLimit: items.some((item) => item.informationLimit) ? "信息不足，需等待更多来源确认" : "",
    sourceName,
    publishedAt: sortedByTime[0]?.publishedAt ?? "",
    url: items[0]?.url ?? "",
    items: items.map((item, index) => ({
      id: item.id,
      originalTitle: item.originalTitle,
      sourceName: item.sourceName,
      publishedAt: item.publishedAt,
      url: item.url,
      titleZh: item.titleZh,
      keyPoints: item.keyPoints,
      whyItMatters: item.whyItMatters,
      informationLimit: item.informationLimit,
      category: item.category,
      rssSummary: item.rssSummary,
      cardItemIndex: index + 1
    }))
  };
}

function countText(value: string): number {
  return value.replace(/\s/g, "").length;
}
