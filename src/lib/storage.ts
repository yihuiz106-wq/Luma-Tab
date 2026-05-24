import type {
  ActiveTrackedSession,
  BookmarkMetadataMap,
  BookmarkPanelState,
  PinnedPage,
  TimeLogEntry,
  UiSettings
} from '../types/app';
import { clearEncryptedApiKey, getEncryptedApiKey, saveEncryptedApiKey } from './secureStorage';

const UI_SETTINGS_KEY = 'uiSettings';
const BOOKMARK_PANEL_STATE_KEY = 'bookmarkPanelState';
const PINNED_PAGES_KEY = 'pinnedPages';
const DEEPSEEK_API_KEY = 'deepseekApiKey';
const AUTO_CLASSIFY_NOTICE_KEY = 'autoClassifyNotice';
const AUTO_CLASSIFY_FAILED_IDS_KEY = 'autoClassifyFailedIds';
const RAW_TIME_LOG_KEY = 'rawTimeLog';
const LAST_UPDATE_TIME_KEY = 'lastUpdateTime';
const ACTIVE_TRACKED_SESSION_KEY = 'activeTrackedSession';
const URL_NAME_CACHE_KEY = 'urlNameCache';
const BOOKMARK_METADATA_KEY = 'bookmarkMetadata';
const HIDDEN_LEFT_PANEL_DOMAINS_KEY = 'hiddenLeftPanelDomains';

export const defaultUiSettings: UiSettings = {
  opacity: 0.9,
  theme: 'light',
  backgroundStyle: 'solid',
  backgroundPrimary: 'none',
  backgroundSecondary: 'none',
  brightness: 100
};

export const defaultBookmarkPanelState: BookmarkPanelState = {
  expandedCategoryIds: {},
  virtualCategories: []
};

export const defaultPinnedPages: PinnedPage[] = [];
export const defaultRawTimeLog: TimeLogEntry[] = [];
export const defaultHiddenLeftPanelDomains: string[] = [];
export const defaultUrlNameCache: Record<string, string> = {};
export const defaultBookmarkMetadata: BookmarkMetadataMap = {};
export const defaultAutoClassifyFailedIds: string[] = [];

function isChromeStorageAvailable() {
  return typeof chrome !== 'undefined' && typeof chrome.storage?.local !== 'undefined';
}

export async function getUiSettings(): Promise<UiSettings> {
  if (isChromeStorageAvailable()) {
    return new Promise((resolve) => {
      chrome.storage.local.get(UI_SETTINGS_KEY, (items) => {
        const storedValue = items[UI_SETTINGS_KEY];
        resolve({
          ...defaultUiSettings,
          ...(storedValue as Partial<UiSettings> | undefined)
        });
      });
    });
  }

  const rawValue = window.localStorage.getItem(UI_SETTINGS_KEY);

  if (!rawValue) {
    return defaultUiSettings;
  }

  try {
    return {
      ...defaultUiSettings,
      ...(JSON.parse(rawValue) as Partial<UiSettings>)
    };
  } catch {
    return defaultUiSettings;
  }
}

export async function saveUiSettings(settings: UiSettings): Promise<void> {
  if (isChromeStorageAvailable()) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [UI_SETTINGS_KEY]: settings }, () => resolve());
    });
  }

  window.localStorage.setItem(UI_SETTINGS_KEY, JSON.stringify(settings));
}

export async function getBookmarkPanelState(): Promise<BookmarkPanelState> {
  if (isChromeStorageAvailable()) {
    return new Promise((resolve) => {
      chrome.storage.local.get(BOOKMARK_PANEL_STATE_KEY, (items) => {
        const storedValue = items[BOOKMARK_PANEL_STATE_KEY];
        resolve({
          ...defaultBookmarkPanelState,
          ...(storedValue as Partial<BookmarkPanelState> | undefined)
        });
      });
    });
  }

  const rawValue = window.localStorage.getItem(BOOKMARK_PANEL_STATE_KEY);

  if (!rawValue) {
    return defaultBookmarkPanelState;
  }

  try {
    return {
      ...defaultBookmarkPanelState,
      ...(JSON.parse(rawValue) as Partial<BookmarkPanelState>)
    };
  } catch {
    return defaultBookmarkPanelState;
  }
}

export async function saveBookmarkPanelState(state: BookmarkPanelState): Promise<void> {
  if (isChromeStorageAvailable()) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [BOOKMARK_PANEL_STATE_KEY]: state }, () => resolve());
    });
  }

  window.localStorage.setItem(BOOKMARK_PANEL_STATE_KEY, JSON.stringify(state));
}

export async function getPinnedPages(): Promise<PinnedPage[]> {
  if (isChromeStorageAvailable()) {
    return new Promise((resolve) => {
      chrome.storage.local.get(PINNED_PAGES_KEY, (items) => {
        const storedValue = items[PINNED_PAGES_KEY];
        resolve(Array.isArray(storedValue) ? (storedValue as PinnedPage[]) : defaultPinnedPages);
      });
    });
  }

  const rawValue = window.localStorage.getItem(PINNED_PAGES_KEY);

  if (!rawValue) {
    return defaultPinnedPages;
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    return Array.isArray(parsed) ? (parsed as PinnedPage[]) : defaultPinnedPages;
  } catch {
    return defaultPinnedPages;
  }
}

export async function savePinnedPages(pinnedPages: PinnedPage[]): Promise<void> {
  if (isChromeStorageAvailable()) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [PINNED_PAGES_KEY]: pinnedPages }, () => resolve());
    });
  }

  window.localStorage.setItem(PINNED_PAGES_KEY, JSON.stringify(pinnedPages));
}

export async function getHiddenLeftPanelDomains(): Promise<string[]> {
  if (isChromeStorageAvailable()) {
    return new Promise((resolve) => {
      chrome.storage.local.get(HIDDEN_LEFT_PANEL_DOMAINS_KEY, (items) => {
        const storedValue = items[HIDDEN_LEFT_PANEL_DOMAINS_KEY];
        resolve(Array.isArray(storedValue) ? storedValue.filter((item): item is string => typeof item === 'string') : defaultHiddenLeftPanelDomains);
      });
    });
  }

  const rawValue = window.localStorage.getItem(HIDDEN_LEFT_PANEL_DOMAINS_KEY);

  if (!rawValue) {
    return defaultHiddenLeftPanelDomains;
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : defaultHiddenLeftPanelDomains;
  } catch {
    return defaultHiddenLeftPanelDomains;
  }
}

export async function saveHiddenLeftPanelDomains(domains: string[]): Promise<void> {
  const normalizedDomains = [...new Set(domains.map((domain) => domain.trim()).filter(Boolean))].sort();

  if (isChromeStorageAvailable()) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [HIDDEN_LEFT_PANEL_DOMAINS_KEY]: normalizedDomains }, () => resolve());
    });
  }

  window.localStorage.setItem(HIDDEN_LEFT_PANEL_DOMAINS_KEY, JSON.stringify(normalizedDomains));
}

export async function getUrlNameCache(): Promise<Record<string, string>> {
  if (isChromeStorageAvailable()) {
    return new Promise((resolve) => {
      chrome.storage.local.get(URL_NAME_CACHE_KEY, (items) => {
        const storedValue = items[URL_NAME_CACHE_KEY];
        resolve(isStringRecord(storedValue) ? storedValue : defaultUrlNameCache);
      });
    });
  }

  const rawValue = window.localStorage.getItem(URL_NAME_CACHE_KEY);

  if (!rawValue) {
    return defaultUrlNameCache;
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    return isStringRecord(parsed) ? parsed : defaultUrlNameCache;
  } catch {
    return defaultUrlNameCache;
  }
}

export async function saveUrlNameCache(urlNameCache: Record<string, string>): Promise<void> {
  if (isChromeStorageAvailable()) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [URL_NAME_CACHE_KEY]: urlNameCache }, () => resolve());
    });
  }

  window.localStorage.setItem(URL_NAME_CACHE_KEY, JSON.stringify(urlNameCache));
}

export async function getBookmarkMetadata(): Promise<BookmarkMetadataMap> {
  if (isChromeStorageAvailable()) {
    return new Promise((resolve) => {
      chrome.storage.local.get(BOOKMARK_METADATA_KEY, (items) => {
        const storedValue = items[BOOKMARK_METADATA_KEY];
        resolve(isBookmarkMetadataMap(storedValue) ? storedValue : defaultBookmarkMetadata);
      });
    });
  }

  const rawValue = window.localStorage.getItem(BOOKMARK_METADATA_KEY);

  if (!rawValue) {
    return defaultBookmarkMetadata;
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    return isBookmarkMetadataMap(parsed) ? parsed : defaultBookmarkMetadata;
  } catch {
    return defaultBookmarkMetadata;
  }
}

export async function saveBookmarkMetadata(bookmarkMetadata: BookmarkMetadataMap): Promise<void> {
  if (isChromeStorageAvailable()) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [BOOKMARK_METADATA_KEY]: bookmarkMetadata }, () => resolve());
    });
  }

  window.localStorage.setItem(BOOKMARK_METADATA_KEY, JSON.stringify(bookmarkMetadata));
}

export async function getDeepSeekApiKey(): Promise<string> {
  if (isChromeStorageAvailable()) {
    return new Promise((resolve) => {
      chrome.storage.local.get(DEEPSEEK_API_KEY, async (items) => {
        const storedValue = items[DEEPSEEK_API_KEY];

        if (typeof storedValue === 'string') {
          try {
            if (storedValue) {
              await saveEncryptedApiKey(storedValue);
              chrome.storage.local.set({ [DEEPSEEK_API_KEY]: { encrypted: true } });
            }
          } catch {
            // Fall back to the legacy plaintext value if secure migration is unavailable.
          }

          resolve(storedValue);
          return;
        }

        try {
          const encryptedValue = await getEncryptedApiKey();
          resolve(encryptedValue ?? '');
        } catch {
          resolve('');
        }
      });
    });
  }

  try {
    const encryptedValue = await getEncryptedApiKey();

    if (encryptedValue !== null) {
      return encryptedValue;
    }
  } catch {
    // Fall back to localStorage in preview environments.
  }

  return window.localStorage.getItem(DEEPSEEK_API_KEY) ?? '';
}

export async function saveDeepSeekApiKey(apiKey: string): Promise<void> {
  if (isChromeStorageAvailable()) {
    try {
      await saveEncryptedApiKey(apiKey);

      return new Promise((resolve) => {
        chrome.storage.local.set({ [DEEPSEEK_API_KEY]: { encrypted: true } }, () => resolve());
      });
    } catch {
      return new Promise((resolve) => {
        chrome.storage.local.set({ [DEEPSEEK_API_KEY]: apiKey }, () => resolve());
      });
    }
  }

  try {
    await saveEncryptedApiKey(apiKey);
    window.localStorage.setItem(DEEPSEEK_API_KEY, '__encrypted__');
  } catch {
    window.localStorage.setItem(DEEPSEEK_API_KEY, apiKey);
  }
}

export async function clearDeepSeekApiKey(): Promise<void> {
  try {
    await clearEncryptedApiKey();
  } catch {
    // Ignore secure-store cleanup failures and clear lightweight storage anyway.
  }

  if (isChromeStorageAvailable()) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [DEEPSEEK_API_KEY]: '' }, () => resolve());
    });
  }

  window.localStorage.removeItem(DEEPSEEK_API_KEY);
}

export async function getAutoClassifyNotice(): Promise<string> {
  if (isChromeStorageAvailable()) {
    return new Promise((resolve) => {
      chrome.storage.local.get(AUTO_CLASSIFY_NOTICE_KEY, (items) => {
        const storedValue = items[AUTO_CLASSIFY_NOTICE_KEY];
        resolve(typeof storedValue === 'string' ? storedValue : '');
      });
    });
  }

  return window.localStorage.getItem(AUTO_CLASSIFY_NOTICE_KEY) ?? '';
}

export async function saveAutoClassifyNotice(message: string): Promise<void> {
  if (isChromeStorageAvailable()) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [AUTO_CLASSIFY_NOTICE_KEY]: message }, () => resolve());
    });
  }

  window.localStorage.setItem(AUTO_CLASSIFY_NOTICE_KEY, message);
}

export async function getAutoClassifyFailedIds(): Promise<string[]> {
  if (isChromeStorageAvailable()) {
    return new Promise((resolve) => {
      chrome.storage.local.get(AUTO_CLASSIFY_FAILED_IDS_KEY, (items) => {
        const storedValue = items[AUTO_CLASSIFY_FAILED_IDS_KEY];
        resolve(Array.isArray(storedValue) ? (storedValue as string[]) : defaultAutoClassifyFailedIds);
      });
    });
  }

  const rawValue = window.localStorage.getItem(AUTO_CLASSIFY_FAILED_IDS_KEY);

  if (!rawValue) {
    return defaultAutoClassifyFailedIds;
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]) : defaultAutoClassifyFailedIds;
  } catch {
    return defaultAutoClassifyFailedIds;
  }
}

export async function saveAutoClassifyFailedIds(bookmarkIds: string[]): Promise<void> {
  if (isChromeStorageAvailable()) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [AUTO_CLASSIFY_FAILED_IDS_KEY]: bookmarkIds }, () => resolve());
    });
  }

  window.localStorage.setItem(AUTO_CLASSIFY_FAILED_IDS_KEY, JSON.stringify(bookmarkIds));
}

export async function getRawTimeLog(): Promise<TimeLogEntry[]> {
  if (isChromeStorageAvailable()) {
    return new Promise((resolve) => {
      chrome.storage.local.get(RAW_TIME_LOG_KEY, (items) => {
        const storedValue = items[RAW_TIME_LOG_KEY];
        resolve(Array.isArray(storedValue) ? (storedValue as TimeLogEntry[]) : defaultRawTimeLog);
      });
    });
  }

  const rawValue = window.localStorage.getItem(RAW_TIME_LOG_KEY);

  if (!rawValue) {
    return defaultRawTimeLog;
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    return Array.isArray(parsed) ? (parsed as TimeLogEntry[]) : defaultRawTimeLog;
  } catch {
    return defaultRawTimeLog;
  }
}

export async function saveRawTimeLog(rawTimeLog: TimeLogEntry[]): Promise<void> {
  if (isChromeStorageAvailable()) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [RAW_TIME_LOG_KEY]: rawTimeLog }, () => resolve());
    });
  }

  window.localStorage.setItem(RAW_TIME_LOG_KEY, JSON.stringify(rawTimeLog));
}

export async function getLastUpdateTime(): Promise<number> {
  if (isChromeStorageAvailable()) {
    return new Promise((resolve) => {
      chrome.storage.local.get(LAST_UPDATE_TIME_KEY, (items) => {
        const storedValue = items[LAST_UPDATE_TIME_KEY];
        resolve(typeof storedValue === 'number' ? storedValue : 0);
      });
    });
  }

  return Number(window.localStorage.getItem(LAST_UPDATE_TIME_KEY) ?? 0);
}

export async function saveLastUpdateTime(timestamp: number): Promise<void> {
  if (isChromeStorageAvailable()) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [LAST_UPDATE_TIME_KEY]: timestamp }, () => resolve());
    });
  }

  window.localStorage.setItem(LAST_UPDATE_TIME_KEY, String(timestamp));
}

export async function getActiveTrackedSession(): Promise<ActiveTrackedSession | null> {
  if (isChromeStorageAvailable()) {
    return new Promise((resolve) => {
      chrome.storage.local.get(ACTIVE_TRACKED_SESSION_KEY, (items) => {
        const storedValue = items[ACTIVE_TRACKED_SESSION_KEY];
        resolve(isActiveTrackedSession(storedValue) ? storedValue : null);
      });
    });
  }

  const rawValue = window.localStorage.getItem(ACTIVE_TRACKED_SESSION_KEY);

  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    return isActiveTrackedSession(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function saveActiveTrackedSession(session: ActiveTrackedSession): Promise<void> {
  if (isChromeStorageAvailable()) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [ACTIVE_TRACKED_SESSION_KEY]: session }, () => resolve());
    });
  }

  window.localStorage.setItem(ACTIVE_TRACKED_SESSION_KEY, JSON.stringify(session));
}

export async function clearActiveTrackedSession(): Promise<void> {
  if (isChromeStorageAvailable()) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [ACTIVE_TRACKED_SESSION_KEY]: null }, () => resolve());
    });
  }

  window.localStorage.removeItem(ACTIVE_TRACKED_SESSION_KEY);
}

function isActiveTrackedSession(value: unknown): value is ActiveTrackedSession {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.tabId === 'number' &&
    typeof candidate.url === 'string' &&
    typeof candidate.title === 'string' &&
    typeof candidate.startedAt === 'number'
  );
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every((item) => typeof item === 'string');
}

function isBookmarkMetadataMap(value: unknown): value is BookmarkMetadataMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return false;
    }

    const candidate = item as Record<string, unknown>;
    return candidate.description === undefined || typeof candidate.description === 'string';
  });
}
