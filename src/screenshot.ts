import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

export async function screenshotCards(htmlCards: string[], runId: string): Promise<string[]> {
  const htmlDir = path.resolve("output/html", runId);
  const imageDir = path.resolve("output/images", runId);
  await fs.mkdir(htmlDir, { recursive: true });
  await fs.mkdir(imageDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1080, height: 1920 },
      deviceScaleFactor: 1
    });

    const files: string[] = [];
    for (let index = 0; index < htmlCards.length; index += 1) {
      const htmlPath = path.join(htmlDir, `card-${index + 1}.html`);
      const imagePath = path.join(imageDir, `card-${index + 1}.png`);
      await fs.writeFile(htmlPath, htmlCards[index], "utf8");
      await page.goto(pathToFileURL(htmlPath).toString(), { waitUntil: "networkidle" });
      await page.screenshot({ path: imagePath, fullPage: false });
      files.push(imagePath);
    }
    return files;
  } finally {
    await browser.close();
  }
}
