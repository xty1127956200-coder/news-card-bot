import type { CardCategory } from "./config.js";

export type NewsItem = {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  summary?: string;
  category?: CardCategory;
  score?: number;
};

export type CardBrief = {
  category: CardCategory;
  headline: string;
  insight: string;
  bullets: string[];
  related: Array<{
    title: string;
    source: string;
    time: string;
  }>;
};

export type RenderPayload = {
  generatedAt: string;
  rangeStart: string;
  rangeEnd: string;
  sources: string[];
  cards: CardBrief[];
};
