import { classifyBookmarksIncrementallyWithDeepSeek } from './lib/deepseek';
import {
  clearActiveTrackedSession,
  getActiveTrackedSession,
  getAutoClassifyFailedIds,
  getBookmarkPanelState,
  getDeepSeekApiKey,
  getRawTimeLog,
  saveActiveTrackedSession,
  saveAutoClassifyFailedIds,
  saveAutoClassifyNotice,
  saveBookmarkPanelState,
  saveRawTimeLog
} from './lib/storage';
import type { ActiveTrackedSession, TimeLogEntry } from './types/app';

const MIN_TRACKED_DURATION = 15_000;
const MAX_LOG_AGE = 72 * 60 * 60 * 1000;

let activeSession: ActiveTrackedSession | null = null;

function isTrackableUrl(url?: string) {
  return typeof url === 'string' && /^https?:\/\//.test(url);
}

function createTimeLogEntry(session: ActiveTrackedSession, endedAt: number): TimeLogEntry | null {
  const duration = endedAt - session.startedAt;

  if (duration < MIN_TRACKED_DURATION) {
    return null;
  }

  try {
    const parsedUrl = new URL(session.url);

    return {
      url: session.url,
      title: session.title || parsedUrl.hostname,
      domain: parsedUrl.hostname.replace(/^www\./, ''),
      duration,
      date: endedAt
    };
  } catch {
    return null;
  }
}

async function flushActiveSession(endedAt = Date.now()) {
  if (!activeSession) {
    activeSession = await getActiveTrackedSession();
  }

  if (!activeSession) {
    return;
  }

  const entry = createTimeLogEntry(activeSession, endedAt);
  activeSession = null;
  await clearActiveTrackedSession();

  if (!entry) {
    return;
  }

  const existingEntries = await getRawTimeLog();
  const threshold = endedAt - MAX_LOG_AGE;
  const nextEntries = [...existingEntries, entry].filter((item) => item.date >= threshold);

  await saveRawTimeLog(nextEntries);
}

async function startSessionFromTab(tabId: number, tab: chrome.tabs.Tab) {
  if (!tab.url || !isTrackableUrl(tab.url)) {
    activeSession = null;
    await clearActiveTrackedSession();
    return;
  }

  activeSession = {
    tabId,
    url: tab.url,
    title: tab.title ?? tab.url,
    startedAt: Date.now()
  };

  await saveActiveTrackedSession(activeSession);
}

async function activateTab(tabId: number) {
  chrome.tabs.get(tabId, async (tab) => {
    await flushActiveSession();
    await startSessionFromTab(tabId, tab);
  });
}

chrome.tabs.onActivated.addListener((activeInfo) => {
  void activateTab(activeInfo.tabId);
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    void flushActiveSession();
    return;
  }

  chrome.tabs.query({ active: true, windowId }, async (tabs) => {
    const activeTab = tabs[0];

    if (!activeTab?.id) {
      await flushActiveSession();
      return;
    }

    await flushActiveSession();
    await startSessionFromTab(activeTab.id, activeTab);
  });
});

chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
  const activeTab = tabs[0];

  if (!activeTab?.id) {
    return;
  }

  const persistedSession = await getActiveTrackedSession();

  if (persistedSession) {
    activeSession = persistedSession;
    return;
  }

  await startSessionFromTab(activeTab.id, activeTab);
});

chrome.bookmarks.onCreated.addListener(async (_id: string, bookmark: chrome.bookmarks.BookmarkTreeNode) => {
  if (!bookmark.url) {
    return;
  }

  const bookmarkLabel = bookmark.title || bookmark.url;

  const apiKey = await getDeepSeekApiKey();
  const failedIds = await getAutoClassifyFailedIds();
  const clearFailure = async () => {
    if (!failedIds.includes(bookmark.id)) {
      return;
    }

    await saveAutoClassifyFailedIds(failedIds.filter((id) => id !== bookmark.id));
  };
  const markFailure = async () => {
    const nextFailedIds = failedIds.includes(bookmark.id) ? failedIds : [...failedIds, bookmark.id];
    await saveAutoClassifyFailedIds(nextFailedIds);
  };

  if (!apiKey.trim()) {
    await markFailure();
    await saveAutoClassifyNotice(
      `${bookmarkLabel} was not auto-classified because no DeepSeek API key is configured. You can place it manually in Organize mode.`
    );
    return;
  }

  const panelState = await getBookmarkPanelState();

  if (panelState.virtualCategories.length === 0) {
    await markFailure();
    await saveAutoClassifyNotice(
      `${bookmarkLabel} was not auto-classified because there are no existing categories yet. You can sort it in Organize mode.`
    );
    return;
  }

  try {
    const result = await classifyBookmarksIncrementallyWithDeepSeek(
      apiKey,
      [
        {
          id: bookmark.id,
          title: bookmarkLabel,
          url: bookmark.url,
          sourcePath: 'New Bookmark'
        }
      ],
      panelState.virtualCategories.map((category) => category.title)
    );

    const targetCategoryTitle = result[bookmark.url];

    if (!targetCategoryTitle || targetCategoryTitle === 'Unclassified') {
      await markFailure();
      await saveAutoClassifyNotice(
        `${bookmarkLabel} could not be matched to an existing category. You can review it in Organize mode.`
      );
      return;
    }

    const nextCategories = panelState.virtualCategories.map((category) => ({
      ...category,
      bookmarkIds: [...category.bookmarkIds]
    }));
    const targetCategory = nextCategories.find((category) => category.title === targetCategoryTitle);

    if (!targetCategory) {
      await markFailure();
      await saveAutoClassifyNotice(
        `${bookmarkLabel} could not be matched to an existing category. You can review it in Organize mode.`
      );
      return;
    }

    if (targetCategory.bookmarkIds.includes(bookmark.id)) {
      await clearFailure();
      await saveAutoClassifyNotice(`${bookmarkLabel} is already in ${targetCategoryTitle}.`);
      return;
    }

    targetCategory.bookmarkIds.push(bookmark.id);

    await saveBookmarkPanelState({
      expandedCategoryIds: panelState.expandedCategoryIds,
      virtualCategories: nextCategories
    });
    await clearFailure();
    await saveAutoClassifyNotice(`${bookmarkLabel} was automatically added to ${targetCategoryTitle}.`);
  } catch {
    await markFailure();
    await saveAutoClassifyNotice(
      `${bookmarkLabel} could not be auto-classified because the DeepSeek request failed. You can review it in Organize mode.`
    );
  }
});
