import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from 'react';
import { MoreHorizontal, Pin, PinOff } from 'lucide-react';
import { createPortal } from 'react-dom';
import FaviconImage from './FaviconImage';
import { getAllBookmarks } from '../lib/bookmarks';
import { simplifyPageNamesWithDeepSeek } from '../lib/deepseek';
import {
  getDeepSeekApiKey,
  getLastUpdateTime,
  getPinnedPages,
  getRawTimeLog,
  getUrlNameCache,
  saveLastUpdateTime,
  savePinnedPages,
  saveRawTimeLog,
  saveUrlNameCache
} from '../lib/storage';
import type { PinnedPage, TimeLogEntry } from '../types/app';

interface FrequentSite {
  domain: string;
  title: string;
  duration: number;
  url: string;
}

const DAILY_UPDATE_INTERVAL = 24 * 60 * 60 * 1000;

function buildContinuePages(entries: TimeLogEntry[]): FrequentSite[] {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const todayEntries = entries.filter((entry) => entry.date >= startOfToday);
  const grouped = new Map<string, FrequentSite>();

  for (const entry of todayEntries) {
    const existing = grouped.get(entry.url);

    if (existing) {
      existing.duration += entry.duration;
      existing.title = entry.title || existing.title;
      continue;
    }

    grouped.set(entry.url, {
      domain: entry.domain || new URL(entry.url).hostname.replace(/^www\./, ''),
      title: entry.title,
      duration: entry.duration,
      url: entry.url
    });
  }

  return [...grouped.values()]
    .filter((entry) => entry.duration >= 30_000)
    .sort((a, b) => b.duration - a.duration)
    .slice(0, 6);
}

function syncPinnedPagesWithBookmarks(pinnedPages: PinnedPage[], bookmarks: Array<{ id: string; title: string; url: string; sourcePath: string }>) {
  const bookmarksById = new Map(bookmarks.map((bookmark) => [bookmark.id, bookmark]));

  return pinnedPages.map((item) => {
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
  });
}

export default function LeftPanel() {
  const [pinnedPages, setPinnedPages] = useState<PinnedPage[]>([]);
  const [continuePages, setContinuePages] = useState<FrequentSite[]>([]);
  const [urlNameCache, setUrlNameCache] = useState<Record<string, string>>({});
  const [bookmarkTitleByUrl, setBookmarkTitleByUrl] = useState<Record<string, string>>({});
  const [editingItem, setEditingItem] = useState<{ kind: 'pinned' | 'continue'; id: string } | null>(null);
  const [menuState, setMenuState] = useState<{
    kind: 'pinned' | 'continue';
    id: string;
    x: number;
    y: number;
  } | null>(null);
  const [draftName, setDraftName] = useState('');
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadLeftPanel() {
      const [storedPinnedPages, rawTimeLog, lastUpdateTime, storedUrlNameCache, deepseekApiKey, bookmarks] = await Promise.all([
        getPinnedPages(),
        getRawTimeLog(),
        getLastUpdateTime(),
        getUrlNameCache(),
        getDeepSeekApiKey(),
        getAllBookmarks()
      ]);
      const nextContinuePages = buildContinuePages(rawTimeLog);
      const nextBookmarkTitleByUrl = Object.fromEntries(bookmarks.map((bookmark) => [bookmark.url, bookmark.title]));

      if (!isMounted) {
        return;
      }

      setPinnedPages(syncPinnedPagesWithBookmarks(storedPinnedPages, bookmarks));
      setContinuePages(nextContinuePages);
      setUrlNameCache(storedUrlNameCache);
      setBookmarkTitleByUrl(nextBookmarkTitleByUrl);

      if (Date.now() - lastUpdateTime > DAILY_UPDATE_INTERVAL) {
        void refreshContinuePageNames(nextContinuePages, storedUrlNameCache, deepseekApiKey);
      }
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

      if (changes.pinnedPages?.newValue && Array.isArray(changes.pinnedPages.newValue)) {
        setPinnedPages(changes.pinnedPages.newValue as PinnedPage[]);
      }

      if (changes.urlNameCache?.newValue && typeof changes.urlNameCache.newValue === 'object') {
        setUrlNameCache(changes.urlNameCache.newValue as Record<string, string>);
      }

      if (changes.rawTimeLog?.newValue && Array.isArray(changes.rawTimeLog.newValue)) {
        setContinuePages(buildContinuePages(changes.rawTimeLog.newValue as TimeLogEntry[]));
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

  const refreshContinuePageNames = async (
    nextContinuePages: FrequentSite[],
    storedUrlNameCache: Record<string, string>,
    deepseekApiKey: string
  ) => {
    const missingSites = nextContinuePages
      .filter((site) => !storedUrlNameCache[site.url])
      .map((site) => ({
        title: site.title,
        url: site.url
      }));

    if (missingSites.length === 0 || !deepseekApiKey.trim()) {
      await saveLastUpdateTime(Date.now());
      return;
    }

    try {
      const simplifiedNames = await simplifyPageNamesWithDeepSeek(deepseekApiKey, missingSites);

      if (Object.keys(simplifiedNames).length === 0) {
        await saveLastUpdateTime(Date.now());
        return;
      }

      const nextUrlNameCache = {
        ...storedUrlNameCache,
        ...simplifiedNames
      };

      setUrlNameCache(nextUrlNameCache);
      setPinnedPages((currentPinnedPages) =>
        currentPinnedPages.map((item) => ({
          ...item,
          customName: nextUrlNameCache[item.url] ?? item.customName
        }))
      );

      await Promise.all([saveUrlNameCache(nextUrlNameCache), saveLastUpdateTime(Date.now())]);
    } catch {
      await saveLastUpdateTime(Date.now());
    }
  };

  const handleUnpin = async (bookmarkId: string) => {
    const nextPinnedPages = pinnedPages.filter((item) => item.id !== bookmarkId);
    setPinnedPages(nextPinnedPages);
    await savePinnedPages(nextPinnedPages);
  };

  const handlePinContinuePage = async (site: FrequentSite) => {
    if (pinnedPages.some((item) => item.url === site.url)) {
      return;
    }

    const nextPinnedPages: PinnedPage[] = [
      {
        id: `pinned-${site.domain}`,
        title: site.title,
        url: site.url,
        sourcePath: site.domain,
        customName: urlNameCache[site.url]
      },
      ...pinnedPages
    ];

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
    const menuWidth = 148;
    const viewportPadding = 12;
    const left = Math.min(
      window.innerWidth - menuWidth - viewportPadding,
      Math.max(viewportPadding, event.clientX)
    );
    const top = Math.min(window.innerHeight - 120, event.clientY);

    setMenuState((current) =>
      current?.kind === kind && current.id === id
        ? null
        : {
            kind,
            id,
            x: left,
            y: top
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
    const nextRawTimeLog = rawTimeLog.filter((entry) => entry.url !== site.url);
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

  return (
    <div className="left-panel">
      <div className="left-panel-block">
        <div className="left-panel-heading">
          <div className="left-panel-title">Common Entrances</div>
        </div>
        <div className="left-panel-list">
          {pinnedPages.length > 0 ? (
            pinnedPages.map((item) => (
              <div
                key={item.id}
                className="item-card left-item-card"
              >
                {editingItem?.kind === 'pinned' && editingItem.id === item.id ? (
                  <span className="left-item-main">
                    <input
                      ref={inputRef}
                      className="left-item-input"
                      value={draftName}
                      onChange={(event) => setDraftName(event.target.value)}
                      onBlur={() => void savePinnedCustomName(item.id, draftName)}
                      onKeyDown={(event) => handleEditKeyDown(event, () => savePinnedCustomName(item.id, draftName))}
                    />
                    <span className="left-item-meta">{item.sourcePath ?? item.url}</span>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="bookmark-section-toggle left-item-open"
                    onClick={() => openBookmark(item.url)}
                  >
                    <span className="left-item-main">
                      <span
                        className="left-item-title"
                      >
                        {getPinnedDisplayName(item.title, item.url, item.customName)}
                      </span>
                      <span className="left-item-meta">{item.sourcePath ?? item.url}</span>
                    </span>
                  </button>
                )}
                <span className="left-item-actions">
                  <button
                    ref={menuState?.kind === 'pinned' && menuState.id === item.id ? menuButtonRef : null}
                    type="button"
                    className={`bookmark-icon-button hover-action-button${menuState?.kind === 'pinned' && menuState.id === item.id ? ' active' : ''}`}
                    aria-label="Open pinned page actions"
                    title="More actions"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                    onClick={(event) => openActionMenu(event, 'pinned', item.id)}
                  >
                    <MoreHorizontal size={14} strokeWidth={1.8} />
                  </button>
                  <button
                    type="button"
                    className="bookmark-icon-button pin-icon-button"
                    aria-label="Unpin site"
                    title="Unpin"
                    onClick={() => void handleUnpin(item.id)}
                  >
                    <PinOff size={14} strokeWidth={1.8} />
                  </button>
                </span>
              </div>
            ))
          ) : (
            <div className="left-placeholder">No pinned pages.</div>
          )}
        </div>
      </div>

      <div className="left-panel-block">
        <div className="left-panel-heading">
          <div className="left-panel-title">Continue Browsing</div>
        </div>
        <div className="left-panel-list">
          {continuePages.length > 0 ? (
            continuePages.map((site) => (
              <div
                key={site.url}
                className="item-card left-item-card"
              >
                {editingItem?.kind === 'continue' && editingItem.id === site.url ? (
                  <span className="left-item-main">
                    <input
                      ref={inputRef}
                      className="left-item-input"
                      value={draftName}
                      onChange={(event) => setDraftName(event.target.value)}
                      onBlur={() => void saveContinueCustomName(site, draftName)}
                      onKeyDown={(event) => handleEditKeyDown(event, () => saveContinueCustomName(site, draftName))}
                    />
                    <span className="left-item-meta">
                      {site.domain}
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
                          {getContinueDisplayName(site)}
                        </span>
                        <span className="left-item-meta">{site.domain}</span>
                      </span>
                    </span>
                  </button>
                )}
                <span className="left-item-actions">
                  <button
                    ref={menuState?.kind === 'continue' && menuState.id === site.url ? menuButtonRef : null}
                    type="button"
                    className={`bookmark-icon-button hover-action-button${menuState?.kind === 'continue' && menuState.id === site.url ? ' active' : ''}`}
                    aria-label="Open continue page actions"
                    title="More actions"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                    onClick={(event) => openActionMenu(event, 'continue', site.url)}
                  >
                    <MoreHorizontal size={14} strokeWidth={1.8} />
                  </button>
                  {(() => {
                    const isPinned = pinnedPages.some((item) => item.url === site.url);

                    return (
                      <button
                        type="button"
                        className={`bookmark-icon-button pin-icon-button${isPinned ? ' active' : ''}`}
                        aria-label={isPinned ? 'Already pinned' : 'Pin site'}
                        title={isPinned ? 'Pinned' : 'Pin'}
                        onClick={() => void handlePinContinuePage(site)}
                        disabled={isPinned}
                      >
                        <Pin size={14} strokeWidth={1.8} />
                      </button>
                    );
                  })()}
                </span>
              </div>
            ))
          ) : (
            <div className="left-placeholder">No pages to continue yet.</div>
          )}
        </div>
      </div>
      {menuState
        ? createPortal(
            <div
              ref={menuRef}
              className="action-menu"
              style={{ left: menuState.x, top: menuState.y }}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                className="action-menu-item"
                onClick={() => {
                  if (menuState.kind === 'pinned') {
                    const target = pinnedPages.find((item) => item.id === menuState.id);

                    if (target) {
                      startEditing('pinned', target.id, getPinnedDisplayName(target.title, target.url, target.customName));
                    }
                  } else {
                    const target = continuePages.find((site) => site.url === menuState.id);

                    if (target) {
                      startEditing('continue', target.url, getContinueDisplayName(target));
                    }
                  }

                  setMenuState(null);
                }}
              >
                Rename
              </button>
              {menuState.kind === 'continue' ? (
                <button
                  type="button"
                  className="action-menu-item action-menu-item-danger"
                  onClick={() => {
                    const target = continuePages.find((site) => site.url === menuState.id);

                    if (target) {
                      void deleteContinuePage(target);
                    }

                    setMenuState(null);
                  }}
                >
                  Delete
                </button>
              ) : null}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
