import OpenAI from "openai";
import { config, getLlmConfig } from "./config.js";
import type { NewsItem } from "./types.js";

type LlmDuplicateGroup = {
  keepId?: string;
  duplicateIds?: string[];
  reason?: string;
};

type LlmDedupeResponse = {
  groups?: LlmDuplicateGroup[];
};

export type SemanticDedupeGroup = {
  kept: NewsItem;
  duplicates: NewsItem[];
  reason?: string;
};

export type SemanticDedupeResult = {
  items: NewsItem[];
  groups: SemanticDedupeGroup[];
  skipped?: boolean;
  error?: string;
};

export async function semanticDedupeNews(items: NewsItem[]): Promise<SemanticDedupeResult> {
  if (items.length <= 1) return { items, groups: [] };
  if (config.MOCK_MODE) {
    return { items, groups: [], skipped: true, error: "MOCK_MODE=true，跳过 LLM 语义去重" };
  }

  const llm = getLlmConfig();
  if (llm.provider !== "deepseek") {
    return { items, groups: [], skipped: true, error: "LLM_PROVIDER 不是 deepseek，跳过 LLM 语义去重" };
  }
  if (!llm.apiKey) {
    return { items, groups: [], skipped: true, error: "DEEPSEEK_API_KEY 缺失，跳过 LLM 语义去重" };
  }

  try {
    const records = items.map((item, index) => ({
      localId: `n${index + 1}`,
      item
    }));
    const client = new OpenAI({
      apiKey: llm.apiKey,
      baseURL: llm.baseURL
    });

    const response = await client.chat.completions.create({
      model: llm.model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "你是保守的新闻语义去重审稿人。你只判断候选新闻是否属于同一主体、同一事件、同一时间段。不要总结新闻，不要改写事实。"
        },
        {
          role: "user",
          content: buildPrompt(records)
        }
      ]
    });

    const content = response.choices[0]?.message.content ?? "{}";
    const parsed = parseLlmDedupeResponse(content);
    return applySemanticGroups(items, records, parsed.groups ?? []);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`LLM 语义去重失败，回退到规则去重结果: ${message}`);
    return { items, groups: [], skipped: true, error: message };
  }
}

function buildPrompt(records: Array<{ localId: string; item: NewsItem }>): string {
  const payload = records.map(({ localId, item }) => ({
    id: localId,
    title: item.originalTitle,
    sourceName: item.sourceName,
    publishedAt: item.publishedAt,
    summary: item.rssSummary ?? "",
    url: item.url
  }));

  return `请对下面新闻做第二层语义去重，只输出 JSON。

合并规则：
1. 只有“同一主体 + 同一事件 + 同一时间段”的新闻才合并。
2. 同一公司、同一行业、同一主题但不同事件，必须保留两条。
3. 如果只是共同提到 OpenAI、NVIDIA、Tesla、Fed 等主体，但动作或事件不同，必须保留两条。
4. 如果不确定是否同一事件，必须保留两条，不要合并。
5. 每个重复组只填写一个 keepId，以及被合并的 duplicateIds。
6. keepId 应选择质量最高的一条：来源可靠、标题完整、有摘要、发布时间更明确或更新。
7. 不要输出没有重复项的组。

输出 JSON schema：
{
  "groups": [
    {
      "keepId": "n1",
      "duplicateIds": ["n2"],
      "reason": "同一主体、同一事件、同一时间段"
    }
  ]
}

候选新闻：
${JSON.stringify(payload, null, 2)}`;
}

function applySemanticGroups(
  originalItems: NewsItem[],
  records: Array<{ localId: string; item: NewsItem }>,
  llmGroups: LlmDuplicateGroup[]
): SemanticDedupeResult {
  const idToItem = new Map(records.map((record) => [record.localId, record.item]));
  const consumed = new Set<string>();
  const duplicateIds = new Set<string>();
  const groups: SemanticDedupeGroup[] = [];

  for (const group of llmGroups) {
    const keepId = cleanId(group.keepId);
    if (!keepId || consumed.has(keepId)) continue;

    const rawDuplicateIds = Array.isArray(group.duplicateIds) ? group.duplicateIds.map(cleanId).filter(Boolean) : [];
    const uniqueDuplicateIds = [...new Set(rawDuplicateIds)].filter(
      (id) => id !== keepId && idToItem.has(id) && !consumed.has(id)
    );
    if (uniqueDuplicateIds.length === 0 || !idToItem.has(keepId)) continue;

    const candidateIds = [keepId, ...uniqueDuplicateIds];
    const candidateItems = candidateIds.map((id) => idToItem.get(id)).filter((item): item is NewsItem => Boolean(item));
    if (candidateItems.length <= 1) continue;

    const kept = pickBestNews(candidateItems);
    const duplicates = candidateItems.filter((item) => item.id !== kept.id);
    if (duplicates.length === 0) continue;

    for (const item of duplicates) {
      duplicateIds.add(item.id);
    }
    for (const id of candidateIds) {
      consumed.add(id);
    }
    groups.push({
      kept,
      duplicates,
      reason: String(group.reason ?? "").slice(0, 180)
    });
  }

  return {
    items: originalItems.filter((item) => !duplicateIds.has(item.id)),
    groups
  };
}

function parseLlmDedupeResponse(content: string): LlmDedupeResponse {
  try {
    return JSON.parse(content) as LlmDedupeResponse;
  } catch {
    const extracted = extractJsonObject(content);
    if (!extracted) {
      throw new Error(`LLM_SEMANTIC_DEDUPE_JSON_PARSE_FAILED: 未找到完整 JSON。原始返回前 1000 字符: ${content.slice(0, 1000)}`);
    }
    try {
      return JSON.parse(extracted) as LlmDedupeResponse;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`LLM_SEMANTIC_DEDUPE_JSON_PARSE_FAILED: ${message}。原始返回前 1000 字符: ${content.slice(0, 1000)}`);
    }
  }
}

function extractJsonObject(text: string): string | null {
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  for (const match of fenced) {
    const candidate = extractBalancedJson(match[1].trim());
    if (candidate) return candidate;
  }
  return extractBalancedJson(text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim());
}

function extractBalancedJson(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

function pickBestNews(items: NewsItem[]): NewsItem {
  return [...items].sort((a, b) => {
    const scoreDiff = qualityScore(b) - qualityScore(a);
    if (Math.abs(scoreDiff) > 3) return scoreDiff;
    return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
  })[0];
}

function qualityScore(item: NewsItem): number {
  const titleLength = countText(item.originalTitle);
  const summaryLength = countText(item.rssSummary ?? "");
  return (
    (item.publishedAt ? 12 : 0) +
    sourceQuality(item.sourceName) +
    Math.min(titleLength, 120) / 6 +
    (summaryLength > 0 ? 10 : 0) +
    Math.min(summaryLength, 260) / 26
  );
}

function sourceQuality(sourceName: string): number {
  const source = sourceName.toLowerCase();
  if (/reuters|bloomberg|associated press|financial times|wall street journal|ap news|cnbc|sec|federal reserve/.test(source)) return 26;
  if (/techcrunch|the verge|wired|ars technica|mit|nasa|bbc|le monde/.test(source)) return 22;
  if (/财新|证券时报|澎湃|36氪|机器之心|量子位|晚点/.test(sourceName)) return 18;
  if (/google news|news\.google|rss/.test(source)) return 8;
  return 12;
}

function countText(value: string): number {
  return value.replace(/\s/g, "").length;
}

function cleanId(value: unknown): string {
  return String(value ?? "").trim();
}
