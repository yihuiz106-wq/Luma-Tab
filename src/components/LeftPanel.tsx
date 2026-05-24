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
  title: string;
  duration: number;
  totalDuration: number;
  lastUsedAt: number;
  url: string;
}

interface ContinueListItem extends FrequentSite {
  isPinned: boolean;
  pinnedPage?: PinnedPage;
}

const MIN_CONTINUE_DURATION = 3 * 60 * 1000;
const CONTINUE_SCORE_DURATION_CAP = 3 * 60 * 60 * 1000;
const CONTINUE_RECENCY_WEIGHT = 0.75;
const CONTINUE_DURATION_WEIGHT = 0.25;

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

function getPinnedPageId(url: string) {
  let hash = 0;

  for (let index = 0; index < url.length; index += 1) {
    hash = (hash * 31 + url.charCodeAt(index)) >>> 0;
  }

  return `pinned-${hash.toString(36)}`;
}

function dedupePinnedPagesByUrl(pinnedPages: PinnedPage[]) {
  const seenUrls = new Set<string>();
  const dedupedPages: PinnedPage[] = [];

  for (const item of pinnedPages) {
    if (!item.url || seenUrls.has(item.url)) {
      continue;
    }

    seenUrls.add(item.url);
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
    const url = entry.url.trim();

    if (!domain || !url) {
      continue;
    }

    const existing = grouped.get(url);

    if (!existing) {
      grouped.set(url, {
        domain,
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

  return dedupePinnedPagesByUrl(pinnedPages.map((item) => {
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
        setPinnedPages(dedupePinnedPagesByUrl(changes.pinnedPages.newValue as PinnedPage[]));
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
    if (pinnedPages.some((item) => item.url === site.url)) {
      const nextPinnedPages = pinnedPages.filter((item) => item.url !== site.url);

      setPinnedPages(nextPinnedPages);
      await savePinnedPages(nextPinnedPages);
      return;
    }

    const nextPinnedPages = dedupePinnedPagesByUrl([
      {
        id: getPinnedPageId(site.url),
        title: site.title,
        url: site.url,
        sourcePath: site.domain,
        customName: urlNameCache[site.url]
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

    if (trimmedName) {
      nextUrlNameCache[target.url] = trimmedName;
    } else {
      delete nextUrlNameCache[target.url];
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
    const nextRawTimeLog = rawTimeLog.filter((entry) => entry.url.trim() !== site.url);
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
      return getPinnedDisplayName(item.pinnedPage.title, item.pinnedPage.url, item.pinnedPage.customName);
    }

    return getContinueDisplayName(item);
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
  const visiblePinnedPages = dedupePinnedPagesByUrl(pinnedPages).filter((item) => !hiddenDomainSet.has(getUrlDomain(item.url)));
  const pinnedUrlSet = new Set(visiblePinnedPages.map((item) => item.url));
  const pinnedContinueItems: ContinueListItem[] = visiblePinnedPages.map((item) => ({
    domain: getUrlDomain(item.url) || item.sourcePath || '',
    title: item.title,
    duration: 0,
    totalDuration: 0,
    lastUsedAt: Number.MAX_SAFE_INTEGER,
    url: item.url,
    isPinned: true,
    pinnedPage: item
  }));
  const visibleContinuePages: ContinueListItem[] = continuePages
    .filter((site) => !hiddenDomainSet.has(normalizeDomain(site.domain)) && !pinnedUrlSet.has(site.url))
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
                      {site.pinnedPage?.sourcePath ?? site.domain}
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
                        <span className="left-item-meta">{site.pinnedPage?.sourcePath ?? site.domain}</span>
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
