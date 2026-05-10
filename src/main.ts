import fs from "node:fs/promises";
import path from "node:path";
import { subHours } from "date-fns";
import { config, effectiveRssUrls, getPublicBaseUrl } from "./config.js";
import { fetchNews, mockNews } from "./fetchNews.js";
import { dedupeNews, rankNews } from "./rankNews.js";
import { renderHtml } from "./renderHtml.js";
import { screenshotCards } from "./screenshot.js";
import { summarizeNewsItems } from "./summarize.js";
import { uploadImages } from "./uploadImage.js";
import { sendPushPlus } from "./sendPushPlus.js";
import type { CardData, FetchNewsResult, RawNewsItem, RenderPayload, SelectedNewsItem } from "./types.js";

async function main() {
  const now = new Date();
  const runId = toRunId(now);
  const lookbackHours = config.NEWS_LOOKBACK_HOURS;
  const maxCards = Math.min(Math.max(Math.floor(config.MAX_NEWS_CARDS), 1), 12);
  const rangeStart = subHours(now, lookbackHours);

  logRuntimeConfig(now, rangeStart, maxCards);

  const fetchResult = config.MOCK_MODE ? mockFetchResult(now, rangeStart) : await fetchNews(rangeStart, now);
  logFetchStats(fetchResult);

  await fs.mkdir("output", { recursive: true });
  await fs.writeFile(path.resolve("output", "raw-news.json"), JSON.stringify(fetchResult.rawNews, null, 2), "utf8");

  const dedupedNews = dedupeNews(fetchResult.recentNews);
  const rankedNews = rankNews(dedupedNews);
  const selectedCandidates = rankedNews.slice(0, maxCards);
  const selectedNews = selectedCandidates.length > 0 ? await summarizeNewsItems(selectedCandidates) : [];
  const cards: CardData[] = selectedNews.length > 0 ? selectedNews : [createEmptyStateCard()];

  await fs.writeFile(path.resolve("output", "selected-news.json"), JSON.stringify(selectedNews, null, 2), "utf8");
  console.log(`去重后剩多少条: ${dedupedNews.length}`);
  console.log(`最终入选多少条: ${selectedNews.length}`);

  const payload: RenderPayload = {
    generatedAt: now.toISOString(),
    rangeStart: rangeStart.toISOString(),
    rangeEnd: now.toISOString(),
    cards,
    rssSourceCount: effectiveRssUrls.length
  };

  await fs.writeFile(path.resolve("output", `${runId}.json`), JSON.stringify(payload, null, 2), "utf8");

  const htmlCards = await renderHtml(payload);
  const imagePaths = await screenshotCards(htmlCards, runId);
  const rootImagePaths = await copyImagesToOutputRoot(imagePaths, runId);
  const publishResult = await uploadImages(imagePaths, runId, payload);

  console.log(`最终生成多少张图片: ${imagePaths.length}`);
  console.log(`是否推送 PushPlus: ${config.ENABLE_PUSH ? "是" : "否"}`);

  if (process.env.GITHUB_ACTIONS === "true") {
    console.log("GitHub Actions detected. Skip PushPlus during generate; push:latest runs after GitHub Pages deploy.");
  } else {
    await sendPushPlus(publishResult.imageUrls.slice(0, maxCards), now.toISOString());
  }

  console.log(`Generated ${imagePaths.length} cards.`);
  console.log(imagePaths.join("\n"));
  console.log("Output artifact PNG files:");
  console.log(rootImagePaths.join("\n"));
  console.log("GitHub Pages card files:");
  console.log(publishResult.localImagePaths.join("\n"));
  console.log("Public URLs or local public paths:");
  console.log(publishResult.imageUrls.join("\n"));
}

function logRuntimeConfig(now: Date, rangeStart: Date, maxCards: number) {
  console.log(`MOCK_MODE=${config.MOCK_MODE}`);
  console.log(`ENABLE_PUSH=${config.ENABLE_PUSH}`);
  console.log(`LLM_PROVIDER=${config.LLM_PROVIDER}`);
  console.log(`NEWS_LOOKBACK_HOURS=${config.NEWS_LOOKBACK_HOURS}`);
  console.log(`MAX_NEWS_CARDS=${maxCards}`);
  console.log(`当前 UTC 时间: ${now.toISOString()}`);
  console.log(`过去2小时起止时间: ${rangeStart.toISOString()} - ${now.toISOString()}`);
  console.log(`RSS 源数量: ${effectiveRssUrls.length}`);
  console.log(`PUBLIC_BASE_URL_EXISTS=${getPublicBaseUrl() ? "true" : "false"}`);
}

function logFetchStats(result: FetchNewsResult) {
  for (const stat of result.sourceStats) {
    if (stat.status === "ok") {
      console.log(`RSS源抓取: ${stat.url} -> ${stat.totalCount} 条，时间过滤后 ${stat.recentCount} 条`);
    } else {
      console.log(`RSS源失败: ${stat.url} -> ${stat.error}`);
    }
  }
  console.log(`时间过滤后剩多少条: ${result.recentNews.length}`);
}

function mockFetchResult(now: Date, rangeStart: Date): FetchNewsResult {
  const news = mockNews(now);
  const rawNews: RawNewsItem[] = news.map((item) => ({
    id: item.id,
    originalTitle: item.originalTitle,
    sourceName: item.sourceName,
    publishedAt: item.publishedAt,
    url: item.url,
    fetchedAt: item.fetchedAt,
    rssUrl: item.rssUrl,
    rssTitle: item.rssTitle,
    summary: item.rssSummary
  }));

  return {
    rawNews,
    recentNews: news.filter((item) => new Date(item.publishedAt) >= rangeStart && new Date(item.publishedAt) <= now),
    sourceStats: [
      {
        url: "mock://local",
        status: "ok",
        totalCount: news.length,
        recentCount: news.length
      }
    ]
  };
}

function createEmptyStateCard(): CardData {
  return {
    type: "empty-state",
    category: "提示",
    titleZh: "过去2小时未抓取到足够可核验新闻",
    summary: "本轮跳过，未生成AI编造内容。",
    facts: ["时间范围严格限定为过去2小时。", "未扩大抓取窗口。", "未使用 AI 编造新闻。"],
    whyItMatters: "保持新闻卡片只基于可核验来源，避免把缺失信息包装成事实。",
    sourceName: "系统提示",
    publishedAt: "",
    url: ""
  };
}

async function copyImagesToOutputRoot(imagePaths: string[], runId: string): Promise<string[]> {
  const copied: string[] = [];
  for (let index = 0; index < imagePaths.length; index += 1) {
    const target = path.resolve("output", `${runId}-card-${index + 1}.png`);
    await fs.copyFile(imagePaths[index], target);
    copied.push(target);
  }
  return copied;
}

function toRunId(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
