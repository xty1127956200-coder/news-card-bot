import { config } from "./config.js";

export async function sendPushPlus(imageUrls: string[], generatedAt: string): Promise<void> {
  const urls = imageUrls.slice(0, Math.min(config.MAX_NEWS_CARDS, 12));
  if (!config.ENABLE_PUSH) {
    console.log("ENABLE_PUSH=false, skip PushPlus.");
    return;
  }
  if (!urls.every((url) => url.startsWith("https://"))) {
    console.log("图片已生成，但未配置 PUBLIC_BASE_URL，跳过 PushPlus 推送。");
    return;
  }
  if (!config.PUSHPLUS_TOKEN || config.PUSHPLUS_TOKEN.startsWith("TODO_")) {
    throw new Error("PUSHPLUS_TOKEN is required when ENABLE_PUSH=true and PUBLIC_BASE_URL is configured.");
  }

  const title = `过去2小时新闻卡片｜${formatDateTime(generatedAt)}`;
  const content = [
    ...urls.map((url) => `<p><img src="${escapeHtml(url)}" style="width:100%;max-width:720px;" /></p>`),
    "<hr />",
    ...urls.map((url, index) => `<p>备用链接 ${index + 1}: <a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>`)
  ].join("\n");

  const response = await fetch("https://www.pushplus.plus/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token: config.PUSHPLUS_TOKEN,
      title,
      content,
      template: "html"
    })
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`PushPlus failed ${response.status}: ${text}`);
  }
  console.log(`PushPlus response: ${text}`);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;"
    };
    return map[char];
  });
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai"
  }).format(new Date(value));
}
