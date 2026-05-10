# News Card Bot

每 2 小时自动抓取新闻、筛选排序、生成中文资讯图片卡片，发布到 GitHub Pages，并通过 PushPlus 推送到微信。

## 当前能力

- TypeScript + Node.js 主流程
- RSS / Google News RSS 新闻抓取
- 过去 2 小时新闻过滤、去重、分类、重要性排序
- DeepSeek 默认中文简报总结，保留 OpenAI 兼容选项
- HTML + CSS 固定模板渲染，Playwright 截图生成 9:16 PNG
- 图片复制到 `web/public/cards/`，由 GitHub Pages 托管
- `web/public/cards/cards.json` 记录历史卡片
- PushPlus HTML 图片推送
- Mock 模式，无 API Key 也能测试视觉效果
- `web/` 轻量 PWA，展示历史新闻卡片
- GitHub Actions 每 2 小时生成、部署 Pages、再推送微信

## Windows 本机从零运行

### 1. 确认 Node.js 和 npm

打开 PowerShell：

```powershell
node --version
npm --version
```

正常会看到类似：

```text
v24.15.0
11.12.1
```

如果 `npm.ps1 cannot be loaded`，用 `npm.cmd` 替代 `npm`：

```powershell
npm.cmd --version
```

### 2. 进入项目目录

```powershell
cd "C:\Users\Zhish\OneDrive\文档\New project 2\news-card-bot"
dir
```

应该能看到 `package.json`、`src`、`web`、`templates`、`styles`。

### 3. 安装依赖

```powershell
npm install
```

如果 PowerShell 拦截：

```powershell
npm.cmd install
```

本项目会在 `postinstall` 阶段自动安装 Playwright Chromium：

```json
"postinstall": "playwright install chromium"
```

如果 Chromium 下载失败，可以单独执行：

```powershell
npx playwright install chromium
```

或：

```powershell
npx.cmd playwright install chromium
```

常见 `npm install` 问题：

- `npm is not recognized`: Node.js/npm 没装好，或 PATH 没生效，重新打开 PowerShell 再试。
- `npm.ps1 cannot be loaded`: 使用 `npm.cmd install`。
- `ENOENT package.json`: 当前目录不对，先 `cd` 到 `news-card-bot`。
- `EPERM` / `EACCES`: 文件被 OneDrive、编辑器或杀毒软件占用，稍等或关闭占用程序后重试。
- Playwright 下载失败：换网络后执行 `npx.cmd playwright install chromium`。

## 本地 Mock 生成

默认就是 mock 模式，不需要 DeepSeek/OpenAI API Key，不抓真实新闻：

```powershell
npm run generate
```

也可以显式运行：

```powershell
npm run generate:mock
```

生成后会出现：

- `output/<runId>.json`: 本次卡片数据
- `output/html/<runId>/card-1.html`: 每张卡片 HTML
- `output/images/<runId>/card-1.png`: 每张卡片 PNG
- `public/cards/<runId>/card-1.png`: 本地公开副本
- `web/public/cards/<runId>-card-1.png`: GitHub Pages / PWA 使用的图片
- `web/public/cards/cards.json`: 历史卡片索引

`runId` 类似 `20260510T105044Z`。

本地检查代码：

```powershell
npm run check
```

## 为什么本地图片不能直接推送到微信

PushPlus 推送正文里使用：

```html
<img src="https://..." />
```

微信客户端只能加载公网可访问的 HTTPS 图片。你电脑里的本地路径，例如：

```text
C:\Users\Zhish\...\card-1.png
```

对微信服务器和手机来说都不可访问，所以不能直接推送。本项目的正确流程是：

1. 本地或 Actions 生成 PNG。
2. 复制到 `web/public/cards/`。
3. GitHub Actions 构建并发布 `web/` 到 GitHub Pages。
4. PushPlus 使用 GitHub Pages 上的 HTTPS 图片链接推送。

如果本地开启了：

```bash
ENABLE_PUSH=true
```

但没有配置 `PUBLIC_BASE_URL`，程序不会中断，会提示：

```text
图片已生成，但未配置 PUBLIC_BASE_URL，跳过 PushPlus 推送。
```

## DeepSeek 配置，推荐方案

复制配置文件：

```powershell
copy .env.example .env
```

真实新闻生成推荐填写：

```bash
MOCK_MODE=false
LLM_PROVIDER=deepseek
DEEPSEEK_API_KEY=TODO_your_deepseek_api_key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
NEWS_RSS_URLS=https://news.google.com/rss/search?q=AI%20OR%20technology%20OR%20finance&hl=zh-CN&gl=CN&ceid=CN:zh-Hans
```

摘要任务默认使用 `deepseek-v4-flash`。如果想要更强效果，可改成：

```bash
DEEPSEEK_MODEL=deepseek-v4-pro
```

OpenAI 是可选兼容方案：

```bash
LLM_PROVIDER=openai
OPENAI_API_KEY=TODO_your_openai_api_key
OPENAI_MODEL=gpt-4o-mini
```

不要上传 `.env` 文件；项目已在 `.gitignore` 中忽略 `.env`。

## PushPlus 单独测试

这个命令不抓新闻、不调用 DeepSeek/OpenAI，只测试 PushPlus：

```powershell
npm run test:pushplus
```

`.env` 至少填写：

```bash
PUSHPLUS_TOKEN=TODO_your_pushplus_token
```

如要测试图片，可填写一个公网 HTTPS 图片：

```bash
TEST_IMAGE_URL=https://example.com/test.png
```

## PUBLIC_BASE_URL 应该怎么填

推荐把 GitHub Pages 的站点根地址填入 `PUBLIC_BASE_URL`：

```bash
PUBLIC_BASE_URL=https://YOUR_USERNAME.github.io/YOUR_REPO
```

程序会自动拼出：

```text
https://YOUR_USERNAME.github.io/YOUR_REPO/cards/<filename>.png
```

如果你更想直接填 cards 目录，也支持：

```bash
PUBLIC_BASE_URL=https://YOUR_USERNAME.github.io/YOUR_REPO/cards
```

程序会自动拼出：

```text
https://YOUR_USERNAME.github.io/YOUR_REPO/cards/<filename>.png
```

## GitHub Pages 设置

在 GitHub 仓库中：

1. 打开 `Settings`。
2. 进入 `Pages`。
3. `Build and deployment` 的 `Source` 选择 `GitHub Actions`。
4. 保存。

之后 `.github/workflows/news.yml` 会负责构建 `web/` 并发布到 Pages。

## GitHub Secrets 和 Variables

进入：

```text
Settings -> Secrets and variables -> Actions
```

Secrets 推荐配置：

- `DEEPSEEK_API_KEY`: 你的 DeepSeek API Key
- `PUSHPLUS_TOKEN`: 你的 PushPlus Token
- `PUBLIC_BASE_URL`: 例如 `https://YOUR_USERNAME.github.io/YOUR_REPO`
- `OPENAI_API_KEY`: 可选，仅 `LLM_PROVIDER=openai` 时需要

Variables 可选配置：

- `LLM_PROVIDER`: 默认 `deepseek`
- `DEEPSEEK_BASE_URL`: 默认 `https://api.deepseek.com`
- `DEEPSEEK_MODEL`: 默认 `deepseek-v4-flash`
- `NEWS_RSS_URLS`: 逗号分隔 RSS 源
- `NEWS_KEYWORDS`: 逗号分隔关键词

不要把 `.env` 上传到 GitHub。只把密钥填到 GitHub Secrets。

## GitHub Actions 自动运行

`.github/workflows/news.yml` 已配置：

```yaml
schedule:
  - cron: "0 */2 * * *"
```

它会每 2 小时运行一次真实新闻流程：

1. 安装依赖。
2. 抓取过去 2 小时新闻。
3. 调用 DeepSeek 总结。
4. 生成 PNG。
5. 写入 `web/public/cards/cards.json`。
6. 构建 `web/` PWA。
7. 发布到 GitHub Pages。
8. 用 GitHub Pages 图片 HTTPS 链接调用 PushPlus。

手动触发测试：

1. 打开 GitHub 仓库的 `Actions`。
2. 选择 `Generate news cards`。
3. 点击 `Run workflow`。
4. 等待 `Deploy GitHub Pages` 完成。
5. 查看 PushPlus / 微信是否收到图片。

## PWA 本地预览

先生成一次卡片：

```powershell
npm run generate:mock
```

再启动 PWA：

```powershell
cd web
npm install
npm run dev
```

PWA 会读取 `/cards/cards.json`，展示最近生成的历史卡片，支持按日期筛选和点击查看高清大图。

iPhone Safari 添加到主屏幕：

1. 打开部署后的 GitHub Pages 网页。
2. 点击分享按钮。
3. 选择“添加到主屏幕”。

## LLM 错误排查

真实运行时，如果 LLM API 出错，程序会尽量打印清晰原因：

- API Key 缺失或无效：检查 `DEEPSEEK_API_KEY` 或 `OPENAI_API_KEY`
- 余额不足或额度不可用：检查 DeepSeek / OpenAI 后台余额和账单
- `429` 限流：稍后重试，或降低运行频率
- 模型名错误：检查 `DEEPSEEK_MODEL` 或 `OPENAI_MODEL`
- 接口地址错误：检查 `DEEPSEEK_BASE_URL`

## TODO 需要你自己填写或操作

- `DEEPSEEK_API_KEY`: `.env` 或 GitHub Secrets
- `PUSHPLUS_TOKEN`: `.env` 或 GitHub Secrets
- `PUBLIC_BASE_URL`: GitHub Pages 地址
- GitHub Pages Source 设置为 GitHub Actions
- PushPlus 微信扫码登录或绑定
- GitHub Secrets 配置
- 任何付款、账号安全、隐私权限授权
