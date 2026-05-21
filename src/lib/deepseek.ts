import type { BookmarkItem } from '../types/app';

const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';
const DEEPSEEK_MODEL = 'deepseek-v4-flash';

interface DeepSeekMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface DeepSeekResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

export type DeepSeekClassificationResult = Record<string, string[]>;
export type DeepSeekIncrementalClassificationResult = Record<string, string>;
export type DeepSeekNameSimplificationResult = Record<string, string>;
const UNCLASSIFIED_ALIASES = new Set(['未分类', 'Unclassified']);

function normalizeCategoryName(value: string) {
  const trimmedValue = value.trim();
  return UNCLASSIFIED_ALIASES.has(trimmedValue) ? 'Unclassified' : trimmedValue;
}

function extractJsonObject(rawText: string) {
  const start = rawText.indexOf('{');
  const end = rawText.lastIndexOf('}');

  if (start < 0 || end < 0 || end <= start) {
    throw new Error('DeepSeek did not return a parsable JSON object.');
  }

  return rawText.slice(start, end + 1);
}

export function buildBookmarkClassificationMessages(bookmarks: BookmarkItem[]): DeepSeekMessage[] {
  const payload = bookmarks.map((bookmark) => ({
    title: bookmark.title,
    url: bookmark.url,
    domain: (() => {
      try {
        return new URL(bookmark.url).hostname;
      } catch {
        return '';
      }
    })(),
    sourcePath: bookmark.sourcePath
  }));

  return [
    {
      role: 'system',
      content:
        '你是一个只输出合法 JSON 的书签分类助手。不要输出 Markdown，不要输出解释，不要输出额外文本。你的任务是做稳定、实用、可长期使用的分类，而不是追求花哨分类。'
    },
    {
      role: 'user',
      content: [
        '请将以下书签归纳为 4-6 个核心分类。如果没有合适的，放入“未分类”。',
        '分类原则：优先按用途和主题分组，例如开发文档、学习课程、工具服务、资讯媒体、娱乐内容、设计灵感，而不是按零散网站名分组。',
        '分类要求：',
        '1. 每个 url 必须且只能出现一次，不能遗漏，不能重复。',
        '2. 分类名必须简短、稳定、可复用，尽量 2-6 个中文词。',
        '3. 尽量避免“其他”“杂项”“网站”等空泛分类，除非确实无法归类。',
        '4. 相同主题但来自不同网站的书签应该尽量归到同一类。',
        '5. 可参考 title、domain 和 sourcePath，但不要机械照抄原书签文件夹结构。',
        '6. 如果书签总量较多，仍然保持 4-6 个主分类，不要分得过碎。',
        '你必须且只能返回合法 JSON，格式示例：{"技术文档":["https://a.com"],"日常工具":["https://b.com"],"未分类":["https://c.com"]}',
        `输入书签：${JSON.stringify(payload)}`
      ].join('\n')
    }
  ];
}

export function parseClassificationResponse(rawText: string): DeepSeekClassificationResult {
  const jsonText = extractJsonObject(rawText.trim());
  const parsed = JSON.parse(jsonText) as unknown;

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('DeepSeek returned a classification result in an invalid format.');
  }

  const result: DeepSeekClassificationResult = {};

  for (const [categoryName, urls] of Object.entries(parsed)) {
    if (!Array.isArray(urls) || !urls.every((url) => typeof url === 'string')) {
      throw new Error(`The value for category "${categoryName}" is not a string array.`);
    }

    result[normalizeCategoryName(categoryName)] = urls;
  }

  return result;
}

export function buildIncrementalClassificationMessages(
  bookmarks: BookmarkItem[],
  existingCategoryTitles: string[]
): DeepSeekMessage[] {
  const payload = bookmarks.map((bookmark) => ({
    title: bookmark.title,
    url: bookmark.url,
    domain: (() => {
      try {
        return new URL(bookmark.url).hostname;
      } catch {
        return '';
      }
    })(),
    sourcePath: bookmark.sourcePath
  }));

  return [
    {
      role: 'system',
      content:
        '你是一个只输出合法 JSON 的书签归类助手。你必须从给定分类中为每个 url 返回唯一分类名。不要输出 Markdown，不要输出解释。优先选择语义最接近、长期最稳定的已有分类。'
    },
    {
      role: 'user',
      content: [
        `已有分类：${JSON.stringify([...existingCategoryTitles, '未分类'])}`,
        '请为每个书签选择唯一分类名，且分类名必须来自已有分类或“未分类”。',
        '规则：',
        '1. 只能从已有分类中选，不要创造新分类名。',
        '2. 如果无法明确匹配，返回“未分类”。',
        '3. 优先按用途和主题匹配，而不是按网站名匹配。',
        '4. 每个 url 必须返回且只能返回一个分类名。',
        '返回格式必须是合法 JSON，例如：{"https://a.com":"技术文档","https://b.com":"未分类"}',
        `输入书签：${JSON.stringify(payload)}`
      ].join('\n')
    }
  ];
}

export function parseIncrementalClassificationResponse(rawText: string): DeepSeekIncrementalClassificationResult {
  const jsonText = extractJsonObject(rawText.trim());
  const parsed = JSON.parse(jsonText) as unknown;

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('DeepSeek returned an incremental classification result in an invalid format.');
  }

  const result: DeepSeekIncrementalClassificationResult = {};

  for (const [url, categoryName] of Object.entries(parsed)) {
    if (typeof categoryName !== 'string') {
      throw new Error(`The classification result for bookmark "${url}" is not a string.`);
    }

    result[url] = normalizeCategoryName(categoryName);
  }

  return result;
}

export function buildNameSimplificationMessages(
  pages: Array<{ title: string; url: string }>
): DeepSeekMessage[] {
  return [
    {
      role: 'system',
      content:
        '你是一个只输出合法 JSON 的网页名称精简助手。不要输出 Markdown，不要输出解释，不要输出额外文本。'
    },
    {
      role: 'user',
      content: [
        '请提取每个网页标题中的核心事物名称，去除网站后缀、副标题、营销词、“教程”、“第X集”等冗余内容。',
        '每个结果尽量控制在 10 个字符以内，直接返回简洁名称。',
        '你必须且只能返回合法 JSON，格式示例：{"https://a.com":"GitHub","https://b.com":"React"}',
        `输入网页：${JSON.stringify(pages)}`
      ].join('\n')
    }
  ];
}

export function parseNameSimplificationResponse(rawText: string): DeepSeekNameSimplificationResult {
  const jsonText = extractJsonObject(rawText.trim());
  const parsed = JSON.parse(jsonText) as unknown;

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('DeepSeek returned a name simplification result in an invalid format.');
  }

  const result: DeepSeekNameSimplificationResult = {};

  for (const [url, simplifiedName] of Object.entries(parsed)) {
    if (typeof simplifiedName !== 'string') {
      throw new Error(`The simplified name for page "${url}" is not a string.`);
    }

    const normalizedName = simplifiedName.trim();

    if (normalizedName) {
      result[url] = normalizedName;
    }
  }

  return result;
}

export async function classifyBookmarksWithDeepSeek(
  apiKey: string,
  bookmarks: BookmarkItem[]
): Promise<DeepSeekClassificationResult> {
  if (!apiKey.trim()) {
    throw new Error('DeepSeek API key is empty.');
  }

  const response = await fetch(DEEPSEEK_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey.trim()}`
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      temperature: 0.1,
      messages: buildBookmarkClassificationMessages(bookmarks)
    })
  });

  if (!response.ok) {
    throw new Error(`DeepSeek request failed with status ${response.status}.`);
  }

  const data = (await response.json()) as DeepSeekResponse;
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('DeepSeek did not return usable content.');
  }

  return parseClassificationResponse(content);
}

export async function classifyBookmarksIncrementallyWithDeepSeek(
  apiKey: string,
  bookmarks: BookmarkItem[],
  existingCategoryTitles: string[]
): Promise<DeepSeekIncrementalClassificationResult> {
  if (!apiKey.trim()) {
    throw new Error('DeepSeek API key is empty.');
  }

  const response = await fetch(DEEPSEEK_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey.trim()}`
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      temperature: 0.1,
      messages: buildIncrementalClassificationMessages(bookmarks, existingCategoryTitles)
    })
  });

  if (!response.ok) {
    throw new Error(`DeepSeek request failed with status ${response.status}.`);
  }

  const data = (await response.json()) as DeepSeekResponse;
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('DeepSeek did not return usable content.');
  }

  return parseIncrementalClassificationResponse(content);
}

export async function simplifyPageNamesWithDeepSeek(
  apiKey: string,
  pages: Array<{ title: string; url: string }>
): Promise<DeepSeekNameSimplificationResult> {
  if (!apiKey.trim()) {
    throw new Error('DeepSeek API key is empty.');
  }

  if (pages.length === 0) {
    return {};
  }

  const response = await fetch(DEEPSEEK_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey.trim()}`
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      temperature: 0.2,
      messages: buildNameSimplificationMessages(pages)
    })
  });

  if (!response.ok) {
    throw new Error(`DeepSeek request failed with status ${response.status}.`);
  }

  const data = (await response.json()) as DeepSeekResponse;
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('DeepSeek did not return usable content.');
  }

  return parseNameSimplificationResponse(content);
}
