import fs from "node:fs/promises";
import path from "node:path";
import { buildPublicImageUrl, config } from "./config.js";
import type { RenderPayload } from "./types.js";

export type PublishedCard = {
  runId: string;
  fileName: string;
  title: string;
  generatedAt: string;
  rangeStart: string;
  rangeEnd: string;
  category: string;
  page: string;
  sources: string[];
  url?: string;
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
  for (let pageIndex = 0; pageIndex < imagePaths.length; pageIndex += 1) {
    const imagePath = imagePaths[pageIndex];
    const originalFileName = path.basename(imagePath);
    const pageFileName = `${runId}-card-${pageIndex + 1}.png`;
    const localPublicPath = path.join(publicDir, originalFileName);
    const webPublicPath = path.join(webCardsDir, pageFileName);
    const url = buildPublicImageUrl(pageFileName);
    const card = payload.cards[pageIndex];

    await fs.copyFile(imagePath, localPublicPath);
    await fs.copyFile(imagePath, webPublicPath);

    imageUrls.push(url ?? webPublicPath);
    localImagePaths.push(webPublicPath);
    records.push({
      runId,
      fileName: pageFileName,
      title: card?.headline ?? `新闻卡片 ${pageIndex + 1}`,
      generatedAt: payload.generatedAt,
      rangeStart: payload.rangeStart,
      rangeEnd: payload.rangeEnd,
      category: card?.category ?? "未分类",
      page: `${pageIndex + 1}/${imagePaths.length}`,
      sources: payload.sources,
      url
    });
  }

  await writeCardsJson(webCardsDir, records);
  await writeLegacyManifest(webCardsDir);

  return {
    imageUrls,
    localImagePaths,
    cards: records
  };
}

async function writeCardsJson(cardsDir: string, records: PublishedCard[]) {
  const cardsJsonPath = path.join(cardsDir, "cards.json");
  let previous: PublishedCard[] = [];
  try {
    const existing = JSON.parse(await fs.readFile(cardsJsonPath, "utf8")) as { cards?: PublishedCard[] };
    previous = existing.cards ?? [];
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
    grouped.set(card.runId, [...(grouped.get(card.runId) ?? []), card]);
  }

  const runs = [...grouped.entries()].map(([runId, cards]) => {
    const sorted = cards.sort((a, b) => Number(a.page.split("/")[0]) - Number(b.page.split("/")[0]));
    const first = sorted[0];
    return {
      id: runId,
      generatedAt: first.generatedAt,
      rangeStart: first.rangeStart,
      rangeEnd: first.rangeEnd,
      images: sorted.map((card) => `/cards/${card.fileName}`),
      sources: first.sources
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
