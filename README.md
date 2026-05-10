# News Card Bot

每 2 小时抓取过去 2 小时内的真实新闻，一条入选新闻生成一张 9:16 竖屏图片，发布到 GitHub Pages，并通过 PushPlus 推送到微信。

## 当前模式

- 一条新闻生成一张图片。
- 每轮默认最多生成 `8` 张。
- 时间范围固定为过去 `2` 小时，不扩大到 6 小时或更长。
- `MOCK_MODE=false` 时绝不 fallback 到 mock 新闻。
- 0 条可核验真实新闻时，会生成 1 张提示卡：`过去2小时未抓取到足够可核验新闻`。
- DeepSeek 只总结输入的 RSS 新闻字段，不允许编造新闻。
- 每条入选新闻保留来源、发布时间、原文链接。

## Windows 本机运行

进入项目：

```powershell
cd "C:\Users\Zhish\OneDrive\文档\New project 2\news-card-bot"
```

检查 Node.js/npm：

```powershell
node --version
npm --version
```

安装依赖：

```powershell
npm install
```

如果 PowerShell 拦截 `npm`，用：

```powershell
npm.cmd install
```

Playwright Chromium 会在 `npm install` 后自动安装。失败时可手动执行：

```powershell
npx.cmd playwright install chromium
```

## 本地 Mock 视觉测试

Mock 只用于本地看卡片视觉效果：

```powershell
npm run generate:mock
```

真实模式不要使用 mock：

```bash
MOCK_MODE=false
```

## 真实新闻配置

复制配置：

```powershell
copy .env.example .env
```

推荐 DeepSeek：

```bash
MOCK_MODE=false
LLM_PROVIDER=deepseek
DEEPSEEK_API_KEY=TODO_your_deepseek_api_key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
NEWS_LOOKBACK_HOURS=2
MAX_NEWS_CARDS=8
```

更强效果可改：

```bash
DEEPSEEK_MODEL=deepseek-v4-pro
```

OpenAI 仍是可选兼容方案：

```bash
LLM_PROVIDER=openai
OPENAI_API_KEY=TODO_your_openai_api_key
```

不要上传 `.env` 文件。

## RSS 源

如果 `NEWS_RSS_URLS` 留空，系统会使用内置 18 个混合 RSS 源，包括 Google News 查询和官方/媒体 RSS：

- AI / 大模型：OpenAI、DeepSeek、Anthropic、Gemini、Meta AI、人工智能、大模型
- 芯片 / 半导体：NVIDIA、AMD、TSMC、台积电、芯片、半导体
- 科技公司：Microsoft、Apple、Google、Meta、Amazon、Tesla
- 马斯克相关：Elon Musk、SpaceX、xAI、Tesla
- 金融市场：Nasdaq、S&P 500、美股、科技股、Federal Reserve、宏观经济
- 国际科技政策：AI regulation、export controls、chip ban、technology policy
- 媒体/机构源：The Verge、TechCrunch、Ars Technica、MIT News、NASA、Federal Reserve、SEC、BBC、Le Monde

自定义 RSS 支持逗号分隔：

```bash
NEWS_RSS_URLS=https://news.google.com/rss/search?q=OpenAI&hl=zh-CN&gl=CN&ceid=CN:zh-Hans,https://techcrunch.com/feed/
```

也支持多行配置，例如在 GitHub Variables 中写多行 URL。某个 RSS 源失败不会中断全部任务，日志会记录失败并继续抓其他源。

## 调整生成数量

默认最多 8 张：

```bash
MAX_NEWS_CARDS=8
```

如果想更稳定，可以调成 6：

```bash
MAX_NEWS_CARDS=6
```

不建议默认 12，因为 DeepSeek 总结、Playwright 截图和微信加载都会变慢。程序仍保留最多 12 张的安全上限。

## 输出文件

每次运行都会生成：

- `output/raw-news.json`
- `output/selected-news.json`
- `output/*.png`
- `web/public/cards/cards.json`

查看全部抓到的原始新闻：

```powershell
Get-Content -Encoding UTF8 output\raw-news.json
```

查看最终入选、用于生成图片的新闻：

```powershell
Get-Content -Encoding UTF8 output\selected-news.json
```

`selected-news.json` 中每条新闻都包含：

- `originalTitle`
- `sourceName`
- `publishedAt`
- `url`
- `fetchedAt`
- `category`
- `summary`
- `facts`
- `whyItMatters`

如果本轮 0 条新闻，`selected-news.json` 会是空数组，同时会生成 1 张提示卡。

## cards.json 核验

PWA 和 GitHub Pages 使用：

```text
web/public/cards/cards.json
```

每张图片对应一条记录，包含：

- `fileName`
- `cardTitle`
- `category`
- `sourceName`
- `publishedAt`
- `url`
- `generatedAt`
- `newsWindowStart`
- `newsWindowEnd`
- `pageIndex`
- `pageTotal`
- `type`

如果 `type` 是 `empty-state`，说明这是“本轮未抓取到新闻”的提示卡。  
你可以通过 `url` 验证每张图对应的原文链接。

## 为什么本地图片不能直接推送微信

PushPlus HTML 里使用：

```html
<img src="https://..." />
```

微信只能加载公网 HTTPS 图片。你电脑上的 `C:\...card-1.png` 对微信不可访问，所以正式推送需要先发布到 GitHub Pages。

本地没有 `PUBLIC_BASE_URL` 时，即使 `ENABLE_PUSH=true`，也只生成图片并提示：

```text
图片已生成，但未配置 PUBLIC_BASE_URL，跳过 PushPlus 推送。
```

## PUBLIC_BASE_URL

推荐填 GitHub Pages 根地址：

```bash
PUBLIC_BASE_URL=https://YOUR_USERNAME.github.io/YOUR_REPO
```

系统会拼出：

```text
https://YOUR_USERNAME.github.io/YOUR_REPO/cards/<filename>.png
```

也可以直接填 cards 目录：

```bash
PUBLIC_BASE_URL=https://YOUR_USERNAME.github.io/YOUR_REPO/cards
```

## PushPlus

单独测试 PushPlus，不抓新闻、不调用 DeepSeek：

```powershell
npm run test:pushplus
```

正式推送默认最多 8 张图，标题：

```text
过去2小时新闻卡片｜{生成时间}
```

内容使用 HTML `<img>` 标签，并附备用链接。

## GitHub Pages 设置

在 GitHub 仓库：

1. 打开 `Settings`。
2. 进入 `Pages`。
3. `Build and deployment` 的 `Source` 选择 `GitHub Actions`。
4. 保存。

## GitHub Secrets 和 Variables

进入：

```text
Settings -> Secrets and variables -> Actions
```

Secrets：

- `DEEPSEEK_API_KEY`
- `PUSHPLUS_TOKEN`
- `PUBLIC_BASE_URL`
- `OPENAI_API_KEY`，可选

Variables：

- `NEWS_RSS_URLS`，可选
- `NEWS_KEYWORDS`，可选
- `DEEPSEEK_MODEL`，可选
- `DEEPSEEK_BASE_URL`，可选

注意：本机 `.env` 不会影响 GitHub Actions。云端必须在 `.github/workflows/news.yml`、GitHub Secrets 或 GitHub Variables 中单独配置。workflow 已明确设置：

```yaml
MOCK_MODE: "false"
ENABLE_PUSH: "true"
LLM_PROVIDER: deepseek
NEWS_LOOKBACK_HOURS: "2"
MAX_NEWS_CARDS: "8"
```

## GitHub Actions

`.github/workflows/news.yml` 支持：

- 每 2 小时自动运行
- `workflow_dispatch` 手动运行

手动运行：

1. 打开 GitHub 仓库 `Actions`。
2. 选择 `Generate news cards`。
3. 点击 `Run workflow`。
4. 选择分支并确认。

每次运行会上传 artifact：

- `output/raw-news.json`
- `output/selected-news.json`
- `output/*.png`

可以在 Actions run 页面下载 artifact，核验新闻来源和图片。

## GitHub Actions 日志

日志会打印：

- `MOCK_MODE`
- `NEWS_LOOKBACK_HOURS`
- `MAX_NEWS_CARDS`
- 当前 UTC 时间
- 过去 2 小时起止时间
- RSS 源数量
- 每个 RSS 源抓到多少条
- 时间过滤后剩多少条
- 去重后剩多少条
- 最终入选多少条
- 最终生成多少张图片
- 是否推送 PushPlus

不会打印任何 API Key 或 Token。

## GitHub Actions 中文字体

如果本机 Windows 生成的卡片中文正常，但 GitHub Actions 生成的微信图片里中文变成方框，通常是因为云端 Ubuntu 环境缺少中文 CJK 字体。Playwright 截图时找不到可用中文字体，就会把汉字渲染成方框。

workflow 已在 `npm run generate` 前安装：

```bash
sudo apt-get update
sudo apt-get install -y fonts-noto-cjk fonts-noto-color-emoji fontconfig
fc-cache -fv
```

并打印：

```bash
fc-match "Noto Sans CJK SC"
fc-list :lang=zh | head -20
```

卡片 CSS 也优先使用 `Noto Sans CJK SC`。本地 Windows 可以继续使用 `Microsoft YaHei`，不会影响云端。

## PWA 本地预览

先生成卡片：

```powershell
npm run generate:mock
```

再启动网页：

```powershell
cd web
npm install
npm run dev
```

PWA 读取 `/cards/cards.json`，展示历史新闻卡片，支持按日期筛选和点击查看高清大图。
