import fs from "node:fs/promises";
import path from "node:path";
import { buildPublicImageUrl, config } from "./config.js";
import { sendPushPlus } from "./sendPushPlus.js";

type CardsJson = {
  cards?: Array<{
    runId: string;
    fileName: string;
    generatedAt: string;
    pageIndex?: number;
  }>;
};

async function main() {
  const cardsJsonPath = path.resolve(config.WEB_PUBLIC_CARDS_DIR, "cards.json");
  const cardsJson = JSON.parse(await fs.readFile(cardsJsonPath, "utf8")) as CardsJson;
  const latestRunId = cardsJson.cards?.[0]?.runId;
  if (!latestRunId) {
    throw new Error(`No card run found in ${cardsJsonPath}`);
  }

  const latestCards = (cardsJson.cards ?? []).filter((card) => card.runId === latestRunId);
  const imageUrls = latestCards
    .sort((a, b) => (a.pageIndex ?? 0) - (b.pageIndex ?? 0))
    .slice(0, config.MAX_NEWS_CARDS)
    .map((card) => buildPublicImageUrl(card.fileName) ?? path.resolve(config.WEB_PUBLIC_CARDS_DIR, card.fileName));

  await sendPushPlus(imageUrls, latestCards[0].generatedAt);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
