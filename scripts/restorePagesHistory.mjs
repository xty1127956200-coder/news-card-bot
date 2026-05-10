import fs from "node:fs/promises";
import path from "node:path";

const publicBaseUrl = process.env.PUBLIC_BASE_URL?.trim();
const cardsDir = path.resolve(process.env.WEB_PUBLIC_CARDS_DIR || "web/public/cards");
const restoreLimit = toPositiveInt(process.env.PAGES_HISTORY_RESTORE_LIMIT, 240);

if (!publicBaseUrl || !publicBaseUrl.startsWith("https://")) {
  console.log("Skip Pages history restore: PUBLIC_BASE_URL is empty or not HTTPS.");
  process.exit(0);
}

const cardsBaseUrl = publicBaseUrl.replace(/\/$/, "").endsWith("/cards")
  ? publicBaseUrl.replace(/\/$/, "")
  : `${publicBaseUrl.replace(/\/$/, "")}/cards`;

await fs.mkdir(cardsDir, { recursive: true });

const cardsJsonUrl = `${cardsBaseUrl}/cards.json`;
const cardsJsonResponse = await fetch(cardsJsonUrl, { cache: "no-store" });

if (!cardsJsonResponse.ok) {
  console.log(`Skip Pages history restore: ${cardsJsonUrl} returned ${cardsJsonResponse.status}.`);
  process.exit(0);
}

const cardsJson = await cardsJsonResponse.json();
const cards = Array.isArray(cardsJson.cards) ? cardsJson.cards.filter(isCardRecord).slice(0, restoreLimit) : [];

await fs.writeFile(
  path.join(cardsDir, "cards.json"),
  JSON.stringify(
    {
      updatedAt: cardsJson.updatedAt || new Date().toISOString(),
      cards
    },
    null,
    2
  ),
  "utf8"
);

let restoredImages = 0;
for (const card of cards) {
  if (!isSafeFileName(card.fileName)) continue;
  const targetPath = path.join(cardsDir, card.fileName);
  if (await exists(targetPath)) continue;

  const imageResponse = await fetch(`${cardsBaseUrl}/${encodeURIComponent(card.fileName)}`, { cache: "no-store" });
  if (!imageResponse.ok) {
    console.log(`Skip old card image ${card.fileName}: ${imageResponse.status}.`);
    continue;
  }

  await fs.writeFile(targetPath, Buffer.from(await imageResponse.arrayBuffer()));
  restoredImages += 1;
}

console.log(`Restored ${cards.length} card records and ${restoredImages} images from GitHub Pages.`);

function isCardRecord(value) {
  return Boolean(value && typeof value.fileName === "string" && typeof value.runId === "string");
}

function isSafeFileName(value) {
  return value === path.basename(value) && value.endsWith(".png");
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function toPositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
