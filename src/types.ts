export type NewsCategory = "AI" | "芯片" | "市场" | "公司" | "政策" | "国际" | "科研" | "其他" | "提示";

export type RawNewsItem = {
  id: string;
  originalTitle: string | null;
  sourceName: string | null;
  publishedAt: string | null;
  url: string | null;
  fetchedAt: string;
  rssUrl: string;
  rssTitle?: string;
  summary?: string;
};

export type NewsItem = {
  id: string;
  originalTitle: string;
  sourceName: string;
  publishedAt: string;
  url: string;
  fetchedAt: string;
  rssUrl: string;
  rssTitle?: string;
  rssSummary?: string;
  category?: NewsCategory;
  score?: number;
};

export type SelectedNewsItem = {
  type: "news";
  id: string;
  originalTitle: string;
  sourceName: string;
  publishedAt: string;
  url: string;
  fetchedAt: string;
  category: Exclude<NewsCategory, "提示">;
  titleZh: string;
  keyPoints: string[];
  whyItMatters: string[];
  informationLimit: string;
  cardId?: string;
  cardType?: "single" | "brief";
  cardItemIndex?: number;
  score?: number;
  rssSummary?: string;
};

export type SingleNewsCard = Omit<SelectedNewsItem, "type"> & {
  type: "single";
  cardId: string;
  cardType: "single";
};

export type BriefNewsItem = Pick<
  SelectedNewsItem,
  | "id"
  | "originalTitle"
  | "sourceName"
  | "publishedAt"
  | "url"
  | "titleZh"
  | "keyPoints"
  | "whyItMatters"
  | "informationLimit"
  | "category"
  | "rssSummary"
> & {
  cardItemIndex: number;
};

export type BriefNewsCard = {
  type: "brief";
  cardId: string;
  cardType: "brief";
  category: Exclude<NewsCategory, "提示">;
  titleZh: string;
  keyPoints: string[];
  whyItMatters: string[];
  informationLimit: string;
  sourceName: string;
  publishedAt: string;
  url: string;
  items: BriefNewsItem[];
};

export type EmptyStateCard = {
  type: "empty-state";
  category: "提示";
  titleZh: "过去2小时未抓取到足够可核验新闻";
  keyPoints: string[];
  whyItMatters: string[];
  informationLimit: string;
  sourceName: string;
  publishedAt: string;
  url: string;
};

export type CardData = SingleNewsCard | BriefNewsCard | EmptyStateCard;

export type RenderPayload = {
  generatedAt: string;
  rangeStart: string;
  rangeEnd: string;
  cards: CardData[];
  rssSourceCount: number;
};

export type FetchNewsResult = {
  rawNews: RawNewsItem[];
  recentNews: NewsItem[];
  sourceStats: Array<{
    url: string;
    status: "ok" | "failed";
    totalCount: number;
    recentCount: number;
    error?: string;
  }>;
};
