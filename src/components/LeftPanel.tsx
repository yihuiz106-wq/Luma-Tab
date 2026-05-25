import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from 'react';
import { MoreHorizontal, Pin, PinOff } from 'lucide-react';
import FaviconImage from './FaviconImage';
import { getAllBookmarks } from '../lib/bookmarks';
import { simplifyPageNamesWithDeepSeek } from '../lib/deepseek';
import {
  getDeepSeekApiKey,
  getHiddenLeftPanelDomains,
  getPinnedPages,
  getRawTimeLog,
  getUrlNameCache,
  saveHiddenLeftPanelDomains,
  savePinnedPages,
  saveRawTimeLog,
  saveUrlNameCache
} from '../lib/storage';
import type { PinnedPage, TimeLogEntry } from '../types/app';

interface FrequentSite {
  domain: string;
  groupKey: string;
  contextLabel: string | null;
  title: string;
  duration: number;
  totalDuration: number;
  lastUsedAt: number;
  url: string;
}

interface ContinueGroupInfo {
  key: string;
  contextLabel: string | null;
}

interface ContinueListItem extends FrequentSite {
  isPinned: boolean;
  pinnedPage?: PinnedPage;
}

const MIN_CONTINUE_DURATION = 3 * 60 * 1000;
const CONTINUE_SCORE_DURATION_CAP = 3 * 60 * 60 * 1000;
const CONTINUE_RECENCY_WEIGHT = 0.75;
const CONTINUE_DURATION_WEIGHT = 0.25;
const CONTINUE_URL_IGNORED_PARAMS = new Set([
  'spm_id_from',
  'vd_source',
  'from',
  'from_source',
  'from_spmid',
  'share_source',
  'share_medium',
  'share_plat',
  'share_session_id',
  'share_tag',
  'si',
  'feature',
  'pp',
  't',
  'start'
]);

function getEntryDomain(entry: TimeLogEntry) {
  if (entry.domain) {
    return normalizeDomain(entry.domain);
  }

  try {
    return normalizeDomain(new URL(entry.url).hostname);
  } catch {
    return '';
  }
}

function normalizeDomain(value: string) {
  return value.trim().replace(/^www\./, '').toLowerCase();
}

function getUrlDomain(url: string) {
  try {
    return normalizeDomain(new URL(url).hostname);
  } catch {
    return '';
  }
}

function isYouTubeDomain(domain: string) {
  return domain === 'youtube.com' || domain === 'm.youtube.com' || domain === 'youtu.be';
}

function isBilibiliDomain(domain: string) {
  return domain === 'bilibili.com' || domain.endsWith('.bilibili.com') || domain === 'b23.tv';
}

function isGitHubDomain(domain: string) {
  return domain === 'github.com';
}

function isCourseraDomain(domain: string) {
  return domain === 'coursera.org';
}

function isEdxDomain(domain: string) {
  return domain === 'edx.org' || domain === 'courses.edx.org' || domain.endsWith('.edx.org');
}

function isUdemyDomain(domain: string) {
  return domain === 'udemy.com' || domain.endsWith('.udemy.com');
}

function isNotionDomain(domain: string) {
  return domain === 'notion.so' || domain.endsWith('.notion.so') || domain.endsWith('.notion.site');
}

function isGoogleDocsDomain(domain: string) {
  return domain === 'docs.google.com';
}

function isFigmaDomain(domain: string) {
  return domain === 'figma.com' || domain === 'www.figma.com';
}

function isFeishuDomain(domain: string) {
  return (
    domain === 'feishu.cn' ||
    domain.endsWith('.feishu.cn') ||
    domain === 'larksuite.com' ||
    domain.endsWith('.larksuite.com')
  );
}

function isYuqueDomain(domain: string) {
  return domain === 'yuque.com' || domain.endsWith('.yuque.com');
}

function isConfluenceDomain(domain: string) {
  return domain === 'atlassian.net' || domain.endsWith('.atlassian.net') || domain === 'confluence.atlassian.com';
}

function getPathSegments(parsedUrl: URL) {
  return parsedUrl.pathname.split('/').filter(Boolean).map((segment) => segment.trim()).filter(Boolean);
}

function normalizeContinueUrl(url: string) {
  try {
    const parsedUrl = new URL(url);
    const domain = normalizeDomain(parsedUrl.hostname);
    const filteredParams = new URLSearchParams();

    for (const [key, value] of parsedUrl.searchParams.entries()) {
      if (CONTINUE_URL_IGNORED_PARAMS.has(key)) {
        continue;
      }

      filteredParams.append(key, value);
    }

    if (isYouTubeDomain(domain)) {
      const videoId =
        domain === 'youtu.be'
          ? parsedUrl.pathname.replace(/^\/+/, '').split('/')[0]
          : filteredParams.get('v');

      const listId = filteredParams.get('list');
      const nextParams = new URLSearchParams();

      if (videoId) {
        nextParams.set('v', videoId);
      }

      if (listId) {
        nextParams.set('list', listId);
      }

      parsedUrl.hostname = 'www.youtube.com';
      parsedUrl.pathname = '/watch';
      parsedUrl.search = nextParams.toString() ? `?${nextParams.toString()}` : '';
      parsedUrl.hash = '';
      return parsedUrl.toString();
    }

    parsedUrl.search = filteredParams.toString() ? `?${filteredParams.toString()}` : '';
    parsedUrl.hash = '';
    return parsedUrl.toString();
  } catch {
    return url.trim();
  }
}

function getBilibiliSeriesKey(parsedUrl: URL) {
  const candidateKeys = ['sid', 'season_id', 'series_id', 'collection_id'];

  for (const key of candidateKeys) {
    const value = parsedUrl.searchParams.get(key)?.trim();

    if (value) {
      return `bilibili-series:${key}:${value}`;
    }
  }

  const pathnameMatch = parsedUrl.pathname.match(/^\/list\/([^/?#]+)/);

  if (pathnameMatch?.[1]) {
    return `bilibili-list:${pathnameMatch[1]}`;
  }

  const videoMatch = parsedUrl.pathname.match(/^\/video\/([^/?#]+)/i);

  if (videoMatch?.[1] && parsedUrl.searchParams.has('p')) {
    return `bilibili-video:${videoMatch[1].toUpperCase()}`;
  }

  return null;
}

function getYouTubeSeriesKey(parsedUrl: URL) {
  const listId = parsedUrl.searchParams.get('list')?.trim();

  if (listId) {
    return `youtube-playlist:${listId}`;
  }

  return null;
}

function getGitHubGroupKey(parsedUrl: URL) {
  const pathSegments = getPathSegments(parsedUrl);

  if (pathSegments.length < 2) {
    return null;
  }

  const [owner, repo] = pathSegments;

  if (!owner || !repo) {
    return null;
  }

  return `github-repo:${owner.toLowerCase()}/${repo.toLowerCase()}`;
}

function getCourseraGroupKey(parsedUrl: URL) {
  const pathSegments = getPathSegments(parsedUrl);

  if (pathSegments.length === 0) {
    return null;
  }

  if (pathSegments[0] === 'learn' && pathSegments[1]) {
    return `coursera-course:${pathSegments[1].toLowerCase()}`;
  }

  if (pathSegments[0] === 'specializations' && pathSegments[1]) {
    return `coursera-specialization:${pathSegments[1].toLowerCase()}`;
  }

  if (pathSegments[0] === 'professional-certificates' && pathSegments[1]) {
    return `coursera-certificate:${pathSegments[1].toLowerCase()}`;
  }

  if (pathSegments[0] === 'projects' && pathSegments[1]) {
    return `coursera-project:${pathSegments[1].toLowerCase()}`;
  }

  return null;
}

function getEdxGroupKey(parsedUrl: URL) {
  const pathSegments = getPathSegments(parsedUrl);

  if (pathSegments.length === 0) {
    return null;
  }

  if (pathSegments[0] === 'learn' && pathSegments[1]) {
    return `edx-learn:${pathSegments[1].toLowerCase()}`;
  }

  if (pathSegments[0] === 'course' && pathSegments[1]) {
    return `edx-course:${pathSegments[1].toLowerCase()}`;
  }

  if (pathSegments[0] === 'courses' && pathSegments[1]) {
    return `edx-courses:${decodeURIComponent(pathSegments[1]).toLowerCase()}`;
  }

  const courseKey =
    parsedUrl.searchParams.get('course_id')?.trim() ||
    parsedUrl.searchParams.get('course')?.trim() ||
    parsedUrl.searchParams.get('course-v1')?.trim();

  if (courseKey) {
    return `edx-course:${courseKey.toLowerCase()}`;
  }

  return null;
}

function getUdemyGroupKey(parsedUrl: URL) {
  const pathSegments = getPathSegments(parsedUrl);

  if (pathSegments[0] !== 'course' || !pathSegments[1]) {
    return null;
  }

  return `udemy-course:${pathSegments[1].toLowerCase()}`;
}

function extractNotionPageToken(pathSegments: string[]) {
  for (let index = pathSegments.length - 1; index >= 0; index -= 1) {
    const segment = pathSegments[index];
    const match = segment.match(/([a-f0-9]{32})$/i);

    if (match?.[1]) {
      return match[1].toLowerCase();
    }
  }

  return null;
}

function getNotionGroupKey(parsedUrl: URL) {
  const domain = normalizeDomain(parsedUrl.hostname);
  const pathSegments = getPathSegments(parsedUrl);

  if (domain !== 'notion.so' && pathSegments.length > 0) {
    return `notion-site:${domain}:${pathSegments[0].toLowerCase()}`;
  }

  const pageToken = extractNotionPageToken(pathSegments);

  if (pageToken) {
    return `notion-page:${pageToken}`;
  }

  if (pathSegments[0]) {
    return `notion-space:${pathSegments[0].toLowerCase()}`;
  }

  return null;
}

function getGoogleDocsGroupInfo(parsedUrl: URL): ContinueGroupInfo | null {
  const pathSegments = getPathSegments(parsedUrl);

  if (pathSegments[0] !== 'document' && pathSegments[0] !== 'spreadsheets' && pathSegments[0] !== 'presentation') {
    return null;
  }

  const documentIdIndex = pathSegments.indexOf('d');
  const documentId = documentIdIndex >= 0 ? pathSegments[documentIdIndex + 1] : null;

  if (!documentId) {
    return null;
  }

  const contextLabelByType: Record<string, string> = {
    document: 'doc',
    spreadsheets: 'sheet',
    presentation: 'slide'
  };

  return {
    key: `google-${pathSegments[0]}:${documentId}`,
    contextLabel: contextLabelByType[pathSegments[0]] ?? 'google'
  };
}

function getFigmaGroupInfo(parsedUrl: URL): ContinueGroupInfo | null {
  const pathSegments = getPathSegments(parsedUrl);

  if (!pathSegments[0] || !pathSegments[1]) {
    return null;
  }

  const figmaContextLabelBySection: Record<string, string> = {
    file: 'figma file',
    design: 'figma file',
    proto: 'prototype',
    board: 'figjam',
    whiteboard: 'figjam',
    slides: 'figma slides'
  };
  const section = pathSegments[0];
  const resourceId = pathSegments[1];
  const contextLabel = figmaContextLabelBySection[section];

  if (!contextLabel) {
    return null;
  }

  return {
    key: `figma:${section}:${resourceId}`,
    contextLabel
  };
}

function getFeishuGroupInfo(parsedUrl: URL): ContinueGroupInfo | null {
  const pathSegments = getPathSegments(parsedUrl);
  const contextLabelBySection: Record<string, string> = {
    docx: 'doc',
    docs: 'doc',
    sheet: 'sheet',
    sheets: 'sheet',
    base: 'base',
    wiki: 'wiki',
    minutes: 'minutes'
  };

  for (let index = 0; index < pathSegments.length; index += 1) {
    const section = pathSegments[index];
    const contextLabel = contextLabelBySection[section];
    const resourceId = pathSegments[index + 1];

    if (contextLabel && resourceId) {
      return {
        key: `feishu:${section}:${resourceId}`,
        contextLabel
      };
    }
  }

  return null;
}

function getYuqueGroupInfo(parsedUrl: URL): ContinueGroupInfo | null {
  const pathSegments = getPathSegments(parsedUrl);

  if (pathSegments.length < 2) {
    return null;
  }

  const [namespace, repo] = pathSegments;

  if (!namespace || !repo) {
    return null;
  }

  return {
    key: `yuque-repo:${namespace.toLowerCase()}/${repo.toLowerCase()}`,
    contextLabel: 'knowledge base'
  };
}

function getConfluenceGroupInfo(parsedUrl: URL): ContinueGroupInfo | null {
  const pathSegments = getPathSegments(parsedUrl);
  const spacesIndex = pathSegments.indexOf('spaces');
  const spaceKeyFromPath = spacesIndex >= 0 ? pathSegments[spacesIndex + 1] : null;
  const spaceKeyFromQuery = parsedUrl.searchParams.get('spaceKey')?.trim();
  const spaceKey = spaceKeyFromPath || spaceKeyFromQuery;

  if (!spaceKey) {
    return null;
  }

  return {
    key: `confluence-space:${spaceKey.toLowerCase()}`,
    contextLabel: 'space'
  };
}

function getContinueGroupInfo(entry: TimeLogEntry): ContinueGroupInfo {
  const normalizedUrl = normalizeContinueUrl(entry.url.trim());

  try {
    const parsedUrl = new URL(normalizedUrl);
    const domain = normalizeDomain(parsedUrl.hostname);

    if (isYouTubeDomain(domain)) {
      const playlistKey = getYouTubeSeriesKey(parsedUrl);

      if (playlistKey) {
        return {
          key: playlistKey,
          contextLabel: 'playlist'
        };
      }
    }

    if (isBilibiliDomain(domain)) {
      const bilibiliSeriesKey = getBilibiliSeriesKey(parsedUrl);

      if (bilibiliSeriesKey) {
        return {
          key: bilibiliSeriesKey,
          contextLabel: 'series'
        };
      }
    }

    if (isGitHubDomain(domain)) {
      const gitHubGroupKey = getGitHubGroupKey(parsedUrl);

      if (gitHubGroupKey) {
        return {
          key: gitHubGroupKey,
          contextLabel: 'repo'
        };
      }
    }

    if (isCourseraDomain(domain)) {
      const courseraGroupKey = getCourseraGroupKey(parsedUrl);

      if (courseraGroupKey) {
        return {
          key: courseraGroupKey,
          contextLabel: 'course'
        };
      }
    }

    if (isEdxDomain(domain)) {
      const edxGroupKey = getEdxGroupKey(parsedUrl);

      if (edxGroupKey) {
        return {
          key: edxGroupKey,
          contextLabel: 'course'
        };
      }
    }

    if (isUdemyDomain(domain)) {
      const udemyGroupKey = getUdemyGroupKey(parsedUrl);

      if (udemyGroupKey) {
        return {
          key: udemyGroupKey,
          contextLabel: 'course'
        };
      }
    }

    if (isNotionDomain(domain)) {
      const notionGroupKey = getNotionGroupKey(parsedUrl);

      if (notionGroupKey) {
        return {
          key: notionGroupKey,
          contextLabel: 'workspace'
        };
      }
    }

    if (isGoogleDocsDomain(domain)) {
      const googleDocsGroupInfo = getGoogleDocsGroupInfo(parsedUrl);

      if (googleDocsGroupInfo) {
        return googleDocsGroupInfo;
      }
    }

    if (isFigmaDomain(domain)) {
      const figmaGroupInfo = getFigmaGroupInfo(parsedUrl);

      if (figmaGroupInfo) {
        return figmaGroupInfo;
      }
    }

    if (isFeishuDomain(domain)) {
      const feishuGroupInfo = getFeishuGroupInfo(parsedUrl);

      if (feishuGroupInfo) {
        return feishuGroupInfo;
      }
    }

    if (isYuqueDomain(domain)) {
      const yuqueGroupInfo = getYuqueGroupInfo(parsedUrl);

      if (yuqueGroupInfo) {
        return yuqueGroupInfo;
      }
    }

    if (isConfluenceDomain(domain)) {
      const confluenceGroupInfo = getConfluenceGroupInfo(parsedUrl);

      if (confluenceGroupInfo) {
        return confluenceGroupInfo;
      }
    }

    return {
      key: normalizedUrl,
      contextLabel: null
    };
  } catch {
    return {
      key: normalizedUrl,
      contextLabel: null
    };
  }
}

function getPinnedPageId(value: string) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return `pinned-${hash.toString(36)}`;
}

function getPinnedPageIdentity(item: PinnedPage) {
  return item.pinnedGroupKey ? `group:${item.pinnedGroupKey}` : `url:${item.url}`;
}

function dedupePinnedPages(pinnedPages: PinnedPage[]) {
  const seenIdentities = new Set<string>();
  const dedupedPages: PinnedPage[] = [];

  for (const item of pinnedPages) {
    const identity = getPinnedPageIdentity(item);

    if (!item.url || seenIdentities.has(identity)) {
      continue;
    }

    seenIdentities.add(identity);
    dedupedPages.push(item);
  }

  return dedupedPages;
}

function buildContinuePages(entries: TimeLogEntry[]): FrequentSite[] {
  const grouped = new Map<string, FrequentSite>();
  const now = Date.now();
  const maxLogAge = 72 * 60 * 60 * 1000;

  for (const entry of entries) {
    const domain = getEntryDomain(entry);
    const url = normalizeContinueUrl(entry.url.trim());
    const groupInfo = getContinueGroupInfo(entry);
    const groupKey = groupInfo.key;

    if (!domain || !url || !groupKey) {
      continue;
    }

    const existing = grouped.get(groupKey);

    if (!existing) {
      grouped.set(groupKey, {
        domain,
        groupKey,
        contextLabel: groupInfo.contextLabel,
        title: entry.title,
        duration: entry.duration,
        totalDuration: entry.duration,
        lastUsedAt: entry.date,
        url
      });
      continue;
    }

    existing.totalDuration += entry.duration;

    if (entry.date > existing.lastUsedAt) {
      existing.lastUsedAt = entry.date;
      existing.title = entry.title;
      existing.url = url;
      existing.domain = domain;
      existing.groupKey = groupKey;
      existing.contextLabel = groupInfo.contextLabel;
      existing.duration = entry.duration;
    }
  }

  const eligibleSites = [...grouped.values()].filter((site) => site.totalDuration >= MIN_CONTINUE_DURATION);

  const scoreSite = (site: FrequentSite) => {
    const recencyAge = Math.max(0, now - site.lastUsedAt);
    const recencyScore = Math.max(0, 1 - recencyAge / maxLogAge);
    const durationScore = Math.min(site.totalDuration / CONTINUE_SCORE_DURATION_CAP, 1);

    return recencyScore * CONTINUE_RECENCY_WEIGHT + durationScore * CONTINUE_DURATION_WEIGHT;
  };

  return eligibleSites
    .sort((a, b) => {
      const scoreDiff = scoreSite(b) - scoreSite(a);

      if (Math.abs(scoreDiff) > 0.02) {
        return scoreDiff;
      }

      if (b.lastUsedAt !== a.lastUsedAt) {
        return b.lastUsedAt - a.lastUsedAt;
      }

      return b.totalDuration - a.totalDuration;
    })
    .slice(0, 6);
}

function syncPinnedPagesWithBookmarks(pinnedPages: PinnedPage[], bookmarks: Array<{ id: string; title: string; url: string; sourcePath: string }>) {
  const bookmarksById = new Map(bookmarks.map((bookmark) => [bookmark.id, bookmark]));

  return dedupePinnedPages(pinnedPages.map((item) => {
    if (item.pinnedGroupKey) {
      return item;
    }

    const bookmark = bookmarksById.get(item.id);

    if (!bookmark) {
      return item;
    }

    return {
      ...item,
      title: bookmark.title,
      url: bookmark.url,
      sourcePath: bookmark.sourcePath
    };
  }));
}

function isNthWeekdayOfMonth(date: Date, month: number, weekday: number, nth: number) {
  if (date.getMonth() !== month || date.getDay() !== weekday) {
    return false;
  }

  return Math.floor((date.getDate() - 1) / 7) + 1 === nth;
}

function getCalendarGreeting(date: Date) {
  const month = date.getMonth();
  const day = date.getDate();
  const fixedGreetingByDate: Record<string, string> = {
    '0-1': 'Happy New Year',
    '1-14': 'Happy Valentine’s Day',
    '2-14': 'Happy Pi Day',
    '3-22': 'Happy Earth Day',
    '4-4': 'May the Fourth be with you',
    '9-31': 'Happy Halloween',
    '11-24': 'Happy Christmas Eve',
    '11-25': 'Merry Christmas',
    '11-31': 'Happy New Year’s Eve'
  };
  const fixedGreeting = fixedGreetingByDate[`${month}-${day}`];

  if (fixedGreeting) {
    return fixedGreeting;
  }

  if (isNthWeekdayOfMonth(date, 10, 4, 4)) {
    return 'Happy Thanksgiving';
  }

  if (isNthWeekdayOfMonth(date, 4, 0, 2)) {
    return 'Happy Mother’s Day';
  }

  if (isNthWeekdayOfMonth(date, 5, 0, 3)) {
    return 'Happy Father’s Day';
  }

  return null;
}

export default function LeftPanel() {
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [pinnedPages, setPinnedPages] = useState<PinnedPage[]>([]);
  const [continuePages, setContinuePages] = useState<FrequentSite[]>([]);
  const [hiddenDomains, setHiddenDomains] = useState<string[]>([]);
  const [urlNameCache, setUrlNameCache] = useState<Record<string, string>>({});
  const [bookmarkTitleByUrl, setBookmarkTitleByUrl] = useState<Record<string, string>>({});
  const [editingItem, setEditingItem] = useState<{ kind: 'pinned' | 'continue'; id: string } | null>(null);
  const [menuState, setMenuState] = useState<{
    kind: 'pinned' | 'continue';
    id: string;
  } | null>(null);
  const [draftName, setDraftName] = useState('');
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const isRefreshingContinueNamesRef = useRef(false);
  const pendingContinuePagesRef = useRef<FrequentSite[] | null>(null);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setCurrentDate(new Date());
    }, 60 * 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  const refreshContinuePageNames = async (
    nextContinuePages: FrequentSite[],
    storedUrlNameCache: Record<string, string>,
    deepseekApiKey: string
  ) => {
    pendingContinuePagesRef.current = nextContinuePages;

    if (isRefreshingContinueNamesRef.current) {
      return;
    }

    isRefreshingContinueNamesRef.current = true;

    try {
      while (pendingContinuePagesRef.current) {
        const pagesToRefresh = pendingContinuePagesRef.current;
        pendingContinuePagesRef.current = null;

        const missingSites = pagesToRefresh
          .filter((site) => !storedUrlNameCache[site.url])
          .map((site) => ({
            title: site.title,
            url: site.url
          }));

        if (missingSites.length === 0 || !deepseekApiKey.trim()) {
          continue;
        }

        try {
          const simplifiedNames = await simplifyPageNamesWithDeepSeek(deepseekApiKey, missingSites);

          if (Object.keys(simplifiedNames).length === 0) {
            continue;
          }

          storedUrlNameCache = {
            ...storedUrlNameCache,
            ...simplifiedNames
          };

          setUrlNameCache(storedUrlNameCache);
          setPinnedPages((currentPinnedPages) =>
            currentPinnedPages.map((item) => ({
              ...item,
              customName: storedUrlNameCache[item.url] ?? item.customName
            }))
          );

          await saveUrlNameCache(storedUrlNameCache);
        } catch {
          // Keep the sidebar responsive even if name simplification fails.
        }
      }
    } finally {
      isRefreshingContinueNamesRef.current = false;
    }
  };

  useEffect(() => {
    let isMounted = true;

    async function loadLeftPanel() {
      const [storedPinnedPages, rawTimeLog, storedHiddenDomains, storedUrlNameCache, deepseekApiKey, bookmarks] = await Promise.all([
        getPinnedPages(),
        getRawTimeLog(),
        getHiddenLeftPanelDomains(),
        getUrlNameCache(),
        getDeepSeekApiKey(),
        getAllBookmarks()
      ]);
      const nextContinuePages = buildContinuePages(rawTimeLog);
      const nextBookmarkTitleByUrl = Object.fromEntries(bookmarks.map((bookmark) => [bookmark.url, bookmark.title]));
      const nextPinnedPages = syncPinnedPagesWithBookmarks(storedPinnedPages, bookmarks);

      if (!isMounted) {
        return;
      }

      setPinnedPages(nextPinnedPages);
      setContinuePages(nextContinuePages);
      setHiddenDomains(storedHiddenDomains.map(normalizeDomain).filter(Boolean));
      setUrlNameCache(storedUrlNameCache);
      setBookmarkTitleByUrl(nextBookmarkTitleByUrl);

      if (nextPinnedPages.length !== storedPinnedPages.length) {
        void savePinnedPages(nextPinnedPages);
      }

      void refreshContinuePageNames(nextContinuePages, storedUrlNameCache, deepseekApiKey);
    }

    void loadLeftPanel();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (typeof chrome === 'undefined' || typeof chrome.bookmarks?.onCreated === 'undefined') {
      return;
    }

    const handleBookmarksChanged = async () => {
      const bookmarks = await getAllBookmarks();
      const nextBookmarkTitleByUrl = Object.fromEntries(bookmarks.map((bookmark) => [bookmark.url, bookmark.title]));

      setBookmarkTitleByUrl(nextBookmarkTitleByUrl);
      setPinnedPages((currentPinnedPages) => {
        const nextPinnedPages = syncPinnedPagesWithBookmarks(currentPinnedPages, bookmarks);
        void savePinnedPages(nextPinnedPages);
        return nextPinnedPages;
      });
    };

    chrome.bookmarks.onCreated.addListener(handleBookmarksChanged);
    chrome.bookmarks.onRemoved?.addListener(handleBookmarksChanged);
    chrome.bookmarks.onChanged?.addListener(handleBookmarksChanged);

    return () => {
      chrome.bookmarks.onCreated.removeListener(handleBookmarksChanged);
      chrome.bookmarks.onRemoved?.removeListener(handleBookmarksChanged);
      chrome.bookmarks.onChanged?.removeListener(handleBookmarksChanged);
    };
  }, []);

  useEffect(() => {
    if (!editingItem) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [editingItem]);

  useEffect(() => {
    if (!menuState) {
      return;
    }

    const handleClick = (event: MouseEvent) => {
      const target = event.target;

      if (!(target instanceof Node)) {
        return;
      }

      if (menuRef.current?.contains(target) || menuButtonRef.current?.contains(target)) {
        return;
      }

      setMenuState(null);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuState(null);
      }
    };

    document.addEventListener('click', handleClick);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('click', handleClick);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuState]);

  useEffect(() => {
    if (typeof chrome === 'undefined' || typeof chrome.storage?.onChanged === 'undefined') {
      return;
    }

    const handleStorageChange = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== 'local') {
        return;
      }

      if ('pinnedPages' in changes && Array.isArray(changes.pinnedPages?.newValue)) {
        setPinnedPages(dedupePinnedPages(changes.pinnedPages.newValue as PinnedPage[]));
      }

      if ('hiddenLeftPanelDomains' in changes && Array.isArray(changes.hiddenLeftPanelDomains?.newValue)) {
        setHiddenDomains((changes.hiddenLeftPanelDomains?.newValue as string[]).map(normalizeDomain).filter(Boolean));
      }

      if ('urlNameCache' in changes && changes.urlNameCache?.newValue && typeof changes.urlNameCache.newValue === 'object') {
        setUrlNameCache(changes.urlNameCache.newValue as Record<string, string>);
      }

      if ('rawTimeLog' in changes && Array.isArray(changes.rawTimeLog?.newValue)) {
        const nextContinuePages = buildContinuePages(changes.rawTimeLog.newValue as TimeLogEntry[]);
        setContinuePages(nextContinuePages);

        void Promise.all([getUrlNameCache(), getDeepSeekApiKey()]).then(([storedUrlNameCache, deepseekApiKey]) =>
          refreshContinuePageNames(nextContinuePages, storedUrlNameCache, deepseekApiKey)
        );
      }
    };

    chrome.storage.onChanged.addListener(handleStorageChange);

    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, []);

  const openBookmark = (url: string) => {
    window.location.href = url;
  };

  const hideLeftPanelDomain = async (domain: string) => {
    const normalizedDomain = normalizeDomain(domain);

    if (!normalizedDomain || hiddenDomains.includes(normalizedDomain)) {
      setMenuState(null);
      return;
    }

    const nextHiddenDomains = [...hiddenDomains, normalizedDomain].sort();
    setHiddenDomains(nextHiddenDomains);
    setMenuState(null);
    await saveHiddenLeftPanelDomains(nextHiddenDomains);
  };

  const handleTogglePinnedPage = async (site: FrequentSite) => {
    if (pinnedPages.some((item) => item.pinnedGroupKey === site.groupKey || (!item.pinnedGroupKey && item.url === site.url))) {
      const nextPinnedPages = pinnedPages.filter((item) => item.pinnedGroupKey !== site.groupKey && item.url !== site.url);

      setPinnedPages(nextPinnedPages);
      await savePinnedPages(nextPinnedPages);
      return;
    }

    const nextPinnedPages = dedupePinnedPages([
      {
        id: getPinnedPageId(site.groupKey),
        title: site.title,
        url: site.url,
        sourcePath: site.domain,
        customName: urlNameCache[site.url],
        pinnedGroupKey: site.groupKey,
        contextLabel: site.contextLabel
      },
      ...pinnedPages
    ]);

    setPinnedPages(nextPinnedPages);
    await savePinnedPages(nextPinnedPages);
  };

  const startEditing = (kind: 'pinned' | 'continue', id: string, currentName: string) => {
    setEditingItem({ kind, id });
    setDraftName(currentName);
  };

  const stopEditing = () => {
    setEditingItem(null);
    setDraftName('');
  };

  const openActionMenu = (event: React.MouseEvent<HTMLElement>, kind: 'pinned' | 'continue', id: string) => {
    event.preventDefault();
    event.stopPropagation();

    setMenuState((current) =>
      current?.kind === kind && current.id === id
        ? null
        : {
          kind,
          id
        }
    );
  };

  const savePinnedCustomName = async (bookmarkId: string, nextName: string) => {
    const target = pinnedPages.find((item) => item.id === bookmarkId);

    if (!target) {
      stopEditing();
      return;
    }

    const trimmedName = nextName.trim();
    const nextPinnedPages = pinnedPages.map((item) =>
      item.id === bookmarkId
        ? {
            ...item,
            customName: trimmedName || undefined
          }
        : item
    );
    const nextUrlNameCache = {
      ...urlNameCache
    };

    if (!target.pinnedGroupKey) {
      if (trimmedName) {
        nextUrlNameCache[target.url] = trimmedName;
      } else {
        delete nextUrlNameCache[target.url];
      }
    }

    setPinnedPages(nextPinnedPages);
    setUrlNameCache(nextUrlNameCache);
    await Promise.all([savePinnedPages(nextPinnedPages), saveUrlNameCache(nextUrlNameCache)]);
    stopEditing();
  };

  const saveContinueCustomName = async (site: FrequentSite, nextName: string) => {
    const trimmedName = nextName.trim();
    const nextUrlNameCache = {
      ...urlNameCache
    };

    if (trimmedName) {
      nextUrlNameCache[site.url] = trimmedName;
    } else {
      delete nextUrlNameCache[site.url];
    }

    setUrlNameCache(nextUrlNameCache);
    await saveUrlNameCache(nextUrlNameCache);
    stopEditing();
  };

  const deleteContinuePage = async (site: FrequentSite) => {
    const rawTimeLog = await getRawTimeLog();
    const nextRawTimeLog = rawTimeLog.filter((entry) => getContinueGroupInfo(entry).key !== site.groupKey);
    const nextContinuePages = buildContinuePages(nextRawTimeLog);

    setContinuePages(nextContinuePages);
    await saveRawTimeLog(nextRawTimeLog);
    stopEditing();
  };

  const handleEditKeyDown = (
    event: ReactKeyboardEvent<HTMLInputElement>,
    saveAction: () => Promise<void>
  ) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void saveAction();
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      stopEditing();
    }
  };

  const getPinnedDisplayName = (title: string, url: string, customName?: string) =>
    customName || urlNameCache[url] || bookmarkTitleByUrl[url] || title;

  const getContinueDisplayName = (site: FrequentSite) => {
    if (urlNameCache[site.url]) {
      return urlNameCache[site.url];
    }

    if (Object.prototype.hasOwnProperty.call(bookmarkTitleByUrl, site.url)) {
      return bookmarkTitleByUrl[site.url];
    }

    return site.title;
  };

  const getContinueListDisplayName = (item: ContinueListItem) => {
    if (item.pinnedPage) {
      return getPinnedDisplayName(item.title, item.url, item.pinnedPage.customName);
    }

    return getContinueDisplayName(item);
  };

  const getContinueListMeta = (item: ContinueListItem) => {
    if (item.pinnedPage) {
      if (item.pinnedPage.pinnedGroupKey) {
        return item.contextLabel ? `${item.contextLabel} • ${item.domain}` : item.domain;
      }

      return item.pinnedPage.sourcePath ?? item.domain;
    }

    return item.contextLabel ? `${item.contextLabel} • ${item.domain}` : item.domain;
  };

  const getGreeting = () => {
    const calendarGreeting = getCalendarGreeting(currentDate);

    if (calendarGreeting) {
      return calendarGreeting;
    }

    const hour = currentDate.getHours();

    if (hour < 6) {
      return 'Have a good night';
    }

    if (hour < 12) {
      return 'Good morning';
    }

    if (hour < 18) {
      return 'Good afternoon';
    }

    return 'Good evening';
  };

  const hiddenDomainSet = new Set(hiddenDomains);
  const continuePageByGroupKey = new Map(continuePages.map((site) => [site.groupKey, site]));
  const visiblePinnedPages = dedupePinnedPages(pinnedPages).filter((item) => {
    const resolvedSite = item.pinnedGroupKey ? continuePageByGroupKey.get(item.pinnedGroupKey) : null;
    const resolvedDomain = resolvedSite?.domain || getUrlDomain(item.url) || item.sourcePath || '';

    return !hiddenDomainSet.has(normalizeDomain(resolvedDomain));
  });
  const pinnedUrlSet = new Set(
    visiblePinnedPages
      .map((item) => (item.pinnedGroupKey ? continuePageByGroupKey.get(item.pinnedGroupKey)?.url : item.url))
      .filter((value): value is string => Boolean(value))
  );
  const pinnedGroupSet = new Set(
    visiblePinnedPages
      .map((item) => item.pinnedGroupKey)
      .filter((value): value is string => Boolean(value))
  );
  const pinnedContinueItems: ContinueListItem[] = visiblePinnedPages.map((item) => {
    const resolvedSite = item.pinnedGroupKey ? continuePageByGroupKey.get(item.pinnedGroupKey) : null;

    return {
      domain: resolvedSite?.domain || getUrlDomain(item.url) || item.sourcePath || '',
      groupKey: item.pinnedGroupKey || normalizeContinueUrl(item.url),
      contextLabel: resolvedSite?.contextLabel ?? item.contextLabel ?? null,
      title: resolvedSite?.title || item.title,
      duration: resolvedSite?.duration ?? 0,
      totalDuration: resolvedSite?.totalDuration ?? 0,
      lastUsedAt: resolvedSite?.lastUsedAt ?? Number.MAX_SAFE_INTEGER,
      url: resolvedSite?.url || item.url,
      isPinned: true,
      pinnedPage: item
    };
  });
  const visibleContinuePages: ContinueListItem[] = continuePages
    .filter((site) => !hiddenDomainSet.has(normalizeDomain(site.domain)) && !pinnedUrlSet.has(site.url) && !pinnedGroupSet.has(site.groupKey))
    .map((site) => ({
      ...site,
      isPinned: false
    }));
  const visibleContinueItems = [...pinnedContinueItems, ...visibleContinuePages];
  const timeText = currentDate.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit'
  });
  const dateText = currentDate.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric'
  });

  return (
    <div className="left-panel">
      <div className="left-panel-block left-time-block">
        <div className="left-time-card">
          <div className="left-time-copy">
            <div className="left-time-label">{getGreeting()}</div>
            <div className="left-time-date">{dateText}</div>
          </div>
          <div className="left-time-value">{timeText}</div>
        </div>
      </div>

      <div className="left-panel-block">
        <div className="left-panel-heading">
          <div className="left-panel-title">Continue Browsing</div>
        </div>
        <div className="left-panel-list">
          {visibleContinueItems.length > 0 ? (
            visibleContinueItems.map((site) => (
              <div
                key={`${site.isPinned ? 'pinned' : 'continue'}-${site.url}`}
                className="item-card left-item-card"
              >
                {editingItem?.kind === (site.isPinned ? 'pinned' : 'continue') && editingItem.id === (site.pinnedPage?.id ?? site.url) ? (
                  <span className="left-item-main">
                    <input
                      ref={inputRef}
                      className="left-item-input"
                      value={draftName}
                      onChange={(event) => setDraftName(event.target.value)}
                      onBlur={() => void (site.pinnedPage ? savePinnedCustomName(site.pinnedPage.id, draftName) : saveContinueCustomName(site, draftName))}
                      onKeyDown={(event) =>
                        handleEditKeyDown(event, () =>
                          site.pinnedPage ? savePinnedCustomName(site.pinnedPage.id, draftName) : saveContinueCustomName(site, draftName)
                        )
                      }
                    />
                    <span className="left-item-meta">
                      {getContinueListMeta(site)}
                    </span>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="bookmark-section-toggle left-item-open"
                    onClick={() => openBookmark(site.url)}
                  >
                    <span className="bookmark-card-content">
                      <FaviconImage url={site.url} className="bookmark-favicon left-item-favicon" />
                      <span className="left-item-main">
                        <span
                          className="left-item-title left-item-title-multiline"
                        >
                          {getContinueListDisplayName(site)}
                        </span>
                        <span className="left-item-meta">{getContinueListMeta(site)}</span>
                      </span>
                    </span>
                  </button>
                )}
                <span className="left-item-actions">
                  <button
                    ref={menuState?.kind === (site.isPinned ? 'pinned' : 'continue') && menuState.id === (site.pinnedPage?.id ?? site.url) ? menuButtonRef : null}
                    type="button"
                    className={`bookmark-icon-button hover-action-button${menuState?.kind === (site.isPinned ? 'pinned' : 'continue') && menuState.id === (site.pinnedPage?.id ?? site.url) ? ' active' : ''}`}
                    aria-label="Open continue page actions"
                    title="More actions"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                    onClick={(event) => openActionMenu(event, site.isPinned ? 'pinned' : 'continue', site.pinnedPage?.id ?? site.url)}
                  >
                    <MoreHorizontal size={14} strokeWidth={1.8} />
                  </button>
                  <button
                    type="button"
                    className={`bookmark-icon-button pin-icon-button${site.isPinned ? ' active' : ''}`}
                    aria-label={site.isPinned ? 'Unpin page' : 'Pin page'}
                    title={site.isPinned ? 'Unpin' : 'Pin'}
                    onClick={() => void handleTogglePinnedPage(site)}
                  >
                    {site.isPinned ? <PinOff size={14} strokeWidth={1.8} /> : <Pin size={14} strokeWidth={1.8} />}
                  </button>
                </span>
                {menuState?.kind === (site.isPinned ? 'pinned' : 'continue') && menuState.id === (site.pinnedPage?.id ?? site.url) ? (
                  <div
                    ref={menuRef}
                    className="action-menu"
                    onMouseDown={(event) => event.stopPropagation()}
                  >
                    <button
                      type="button"
                      className="action-menu-item"
                      onClick={() => {
                        startEditing(site.isPinned ? 'pinned' : 'continue', site.pinnedPage?.id ?? site.url, getContinueListDisplayName(site));
                        setMenuState(null);
                      }}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      className="action-menu-item"
                      onClick={() => {
                        void hideLeftPanelDomain(getUrlDomain(site.url) || site.domain);
                      }}
                    >
                      Hide Domain
                    </button>
                    {!site.isPinned ? (
                      <button
                        type="button"
                        className="action-menu-item action-menu-item-danger"
                        onClick={() => {
                          void deleteContinuePage(site);
                          setMenuState(null);
                        }}
                      >
                        Delete
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ))
          ) : (
            <div className="left-placeholder">No pages to continue yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}
