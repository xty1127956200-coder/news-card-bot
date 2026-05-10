import fs from "node:fs/promises";
import path from "node:path";
import { subHours } from "date-fns";
import { config } from "./config.js";
import { fetchNews, mockNews } from "./fetchNews.js";
import { groupTopNews, rankNews } from "./rankNews.js";
import { renderHtml } from "./renderHtml.js";
import { screenshotCards } from "./screenshot.js";
import { summarizeCards } from "./summarize.js";
import { uploadImages } from "./uploadImage.js";
import { sendPushPlus } from "./sendPushPlus.js";
import type { RenderPayload } from "./types.js";

async function main() {
  const now = new Date();
  const runId = toRunId(now);
  const rangeStart = subHours(now, 2);

  const rawNews = config.MOCK_MODE ? mockNews(now) : await fetchNews(now);
  if (rawNews.length === 0) {
    if (!config.MOCK_MODE) {
      throw new Error("真实模式未抓到足够新闻，已停止生成，避免生成虚假新闻。");
    }
    console.log("No mock news found. Use MOCK_MODE=true to test rendering.");
    return;
  }

  const rankedNews = rankNews(rawNews);
  const groups = groupTopNews(rankedNews);
  const cards = await summarizeCards(groups);

  const payload: RenderPayload = {
    generatedAt: now.toISOString(),
    rangeStart: rangeStart.toISOString(),
    rangeEnd: now.toISOString(),
    sources: [...new Set(rankedNews.map((item) => item.source))],
    cards
  };

  await fs.mkdir("output", { recursive: true });
  await fs.writeFile(path.resolve("output", `${runId}.json`), JSON.stringify(payload, null, 2), "utf8");

  const htmlCards = await renderHtml(payload);
  const imagePaths = await screenshotCards(htmlCards, runId);
  const publishResult = await uploadImages(imagePaths, runId, payload);
  await writeManifest(payload, publishResult.imageUrls, runId);
  if (process.env.GITHUB_ACTIONS === "true") {
    console.log("GitHub Actions detected. Skip PushPlus during generate; push:latest runs after GitHub Pages deploy.");
  } else {
    await sendPushPlus(publishResult.imageUrls, now.toISOString());
  }

  console.log(`Generated ${imagePaths.length} cards.`);
  console.log(imagePaths.join("\n"));
  console.log("GitHub Pages card files:");
  console.log(publishResult.localImagePaths.join("\n"));
  console.log("Public URLs or local public paths:");
  console.log(publishResult.imageUrls.join("\n"));
}

function toRunId(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

async function writeManifest(payload: RenderPayload, imageUrls: string[], runId: string) {
  const manifestPath = path.resolve(config.PUBLIC_OUTPUT_DIR, "manifest.json");
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });

  let previous: unknown[] = [];
  try {
    const existing = JSON.parse(await fs.readFile(manifestPath, "utf8")) as { runs?: unknown[] };
    previous = existing.runs ?? [];
  } catch {
    previous = [];
  }

  const next = {
    updatedAt: payload.generatedAt,
    runs: [
      {
        id: runId,
        generatedAt: payload.generatedAt,
        rangeStart: payload.rangeStart,
        rangeEnd: payload.rangeEnd,
        images: imageUrls,
        sources: payload.sources
      },
      ...previous
    ].slice(0, 240)
  };

  await fs.writeFile(manifestPath, JSON.stringify(next, null, 2), "utf8");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
