import fs from "node:fs/promises";
import path from "node:path";
import { buildPublicImageUrl, config } from "./config.js";
import type { CardData, RenderPayload } from "./types.js";

export type PublishedCard = {
  type: "single" | "brief" | "empty-state" | "news";
  runId: string;
  fileName: string;
  cardTitle: string;
  category: string;
  sourceName: string;
  publishedAt: string;
  url: string;
  generatedAt: string;
  newsWindowStart: string;
  newsWindowEnd: string;
  pageIndex: number;
  pageTotal: number;
  imageUrl?: string;
  items?: Array<{
    titleZh: string;
    sourceName: string;
    publishedAt: string;
    url: string;
    keyPoints: string[];
  }>;
};

export type PublishResult = {
  imageUrls: string[];
  localImagePaths: string[];
  cards: PublishedCard[];
};

export async function uploadImages(imagePaths: string[], runId: string, payload: RenderPayload): Promise<PublishResult> {
  const publicDir = path.resolve(config.PUBLIC_OUTPUT_DIR, runId);
  const webCardsDir = path.resolve(config.WEB_PUBLIC_CARDS_DIR);
  await fs.mkdir(publicDir, { recursive: true });
  await fs.mkdir(webCardsDir, { recursive: true });

  const imageUrls: string[] = [];
  const localImagePaths: string[] = [];
  const records: PublishedCard[] = [];
  const pageTotal = imagePaths.length;

  for (let pageIndex = 0; pageIndex < imagePaths.length; pageIndex += 1) {
    const imagePath = imagePaths[pageIndex];
    const originalFileName = path.basename(imagePath);
    const pageFileName = `${runId}-card-${pageIndex + 1}.png`;
    const localPublicPath = path.join(publicDir, originalFileName);
    const webPublicPath = path.join(webCardsDir, pageFileName);
    const imageUrl = buildPublicImageUrl(pageFileName);
    const card = payload.cards[pageIndex];

    await fs.copyFile(imagePath, localPublicPath);
    await fs.copyFile(imagePath, webPublicPath);

    imageUrls.push(imageUrl ?? webPublicPath);
    localImagePaths.push(webPublicPath);
    records.push(toPublishedCard(card, runId, pageFileName, payload, pageIndex + 1, pageTotal, imageUrl));
  }

  await writeCardsJson(webCardsDir, records);
  await writeLegacyManifest(webCardsDir);

  return {
    imageUrls,
    localImagePaths,
    cards: records
  };
}

function toPublishedCard(
  card: CardData,
  runId: string,
  fileName: string,
  payload: RenderPayload,
  pageIndex: number,
  pageTotal: number,
  imageUrl: string | undefined
): PublishedCard {
  const base = {
    type: card.type,
    runId,
    fileName,
    cardTitle: card.titleZh,
    category: card.category,
    sourceName: card.sourceName,
    publishedAt: card.publishedAt,
    url: card.url,
    generatedAt: payload.generatedAt,
    newsWindowStart: payload.rangeStart,
    newsWindowEnd: payload.rangeEnd,
    pageIndex,
    pageTotal,
    imageUrl
  };

  if (card.type !== "brief") {
    return base;
  }

  return {
    ...base,
    items: card.items.map((item) => ({
      titleZh: item.titleZh,
      sourceName: item.sourceName,
      publishedAt: item.publishedAt,
      url: item.url,
      keyPoints: item.keyPoints
    }))
  };
}

async function writeCardsJson(cardsDir: string, records: PublishedCard[]) {
  const cardsJsonPath = path.join(cardsDir, "cards.json");
  let previous: PublishedCard[] = [];
  try {
    const existing = JSON.parse(await fs.readFile(cardsJsonPath, "utf8")) as { cards?: PublishedCard[] };
    previous = (existing.cards ?? []).filter(isPublishedCard);
  } catch {
    previous = [];
  }

  const names = new Set(records.map((record) => record.fileName));
  const nextCards = [...records, ...previous.filter((record) => !names.has(record.fileName))].slice(0, 1200);
  await fs.writeFile(
    cardsJsonPath,
    JSON.stringify(
      {
        updatedAt: records[0]?.generatedAt ?? new Date().toISOString(),
        cards: nextCards
      },
      null,
      2
    ),
    "utf8"
  );
}

async function writeLegacyManifest(cardsDir: string) {
  const cardsJsonPath = path.join(cardsDir, "cards.json");
  const manifestPath = path.join(cardsDir, "manifest.json");
  const cardsJson = JSON.parse(await fs.readFile(cardsJsonPath, "utf8")) as { updatedAt?: string; cards?: PublishedCard[] };
  const grouped = new Map<string, PublishedCard[]>();
  for (const card of cardsJson.cards ?? []) {
    if (isPublishedCard(card)) grouped.set(card.runId, [...(grouped.get(card.runId) ?? []), card]);
  }

  const runs = [...grouped.entries()].map(([runId, cards]) => {
    const sorted = cards.sort((a, b) => a.pageIndex - b.pageIndex);
    const first = sorted[0];
    return {
      id: runId,
      generatedAt: first.generatedAt,
      rangeStart: first.newsWindowStart,
      rangeEnd: first.newsWindowEnd,
      images: sorted.map((card) => `/cards/${card.fileName}`),
      sources: [...new Set(sorted.map((card) => card.sourceName).filter(Boolean))]
    };
  });

  await fs.writeFile(
    manifestPath,
    JSON.stringify(
      {
        updatedAt: cardsJson.updatedAt ?? new Date().toISOString(),
        runs
      },
      null,
      2
    ),
    "utf8"
  );
}

function isPublishedCard(value: unknown): value is PublishedCard {
  const card = value as Partial<PublishedCard>;
  return Boolean(card?.fileName && card.cardTitle && card.generatedAt && card.newsWindowStart && card.newsWindowEnd);
}
