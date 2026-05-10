import "dotenv/config";

const token = process.env.PUSHPLUS_TOKEN;
const testImageUrl = process.env.TEST_IMAGE_URL;

async function main() {
  if (!token || token.startsWith("TODO_")) {
    throw new Error("PUSHPLUS_TOKEN is required. Put it in .env before running npm run test:pushplus.");
  }

  if (testImageUrl && !testImageUrl.startsWith("https://")) {
    throw new Error("TEST_IMAGE_URL must start with https:// if provided.");
  }

  const now = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(new Date());

  const content = [
    "<h3>PushPlus 测试成功</h3>",
    `<p>这是一条本地测试消息，发送时间：${escapeHtml(now)}</p>`,
    testImageUrl
      ? `<p><img src="${escapeHtml(testImageUrl)}" style="width:100%;max-width:720px;" /></p>`
      : "<p>未配置 TEST_IMAGE_URL，所以本次只测试文字 HTML 推送。</p>"
  ].join("\n");

  const response = await fetch("https://www.pushplus.plus/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token,
      title: `PushPlus 本地测试｜${now}`,
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

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
