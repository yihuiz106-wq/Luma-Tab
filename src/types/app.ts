export interface BookmarkItem {
  id: string;
  title: string;
  url: string;
  sourcePath: string;
}

export interface VirtualBookmarkCategory {
  id: string;
  title: string;
  bookmarkIds: string[];
}

export interface BookmarkCategory {
  id: string;
  title: string;
  bookmarks: BookmarkItem[];
  isVirtual?: boolean;
  isSystem?: boolean;
}

export interface PinnedPage {
  id: string;
  title: string;
  url: string;
  sourcePath?: string;
  customName?: string;
}

export interface UiSettings {
  opacity: number;
  theme: 'light';
  backgroundStyle: 'solid' | 'gradient';
  backgroundPrimary: 'none' | 'mist' | 'sky' | 'ocean' | 'teal' | 'mint' | 'sage' | 'lavender' | 'pearl';
  backgroundSecondary: 'none' | 'mist' | 'sky' | 'ocean' | 'teal' | 'mint' | 'sage' | 'lavender' | 'pearl';
  brightness: number;
}

export interface BookmarkPanelState {
  expandedCategoryIds: Record<string, boolean>;
  virtualCategories: VirtualBookmarkCategory[];
}

export type FullAiClassificationMode = 'overwrite' | 'unclassified_only';

export interface AppStorageShape {
  uiSettings: UiSettings;
  bookmarkPanelState: BookmarkPanelState;
  pinnedPages?: PinnedPage[];
  urlNameCache?: Record<string, string>;
  bookmarkMetadata?: BookmarkMetadataMap;
  autoClassifyFailedIds?: string[];
  deepseekApiKey?: string;
}

export interface AppDataExport {
  version: 1;
  exportedAt: string;
  uiSettings: UiSettings;
  bookmarkPanelState: BookmarkPanelState;
  pinnedPages: PinnedPage[];
  urlNameCache: Record<string, string>;
  bookmarkMetadata: BookmarkMetadataMap;
  autoClassifyFailedIds: string[];
  rawTimeLog: TimeLogEntry[];
  lastUpdateTime: number;
  deepseekApiKey: string;
  backgroundImage: string | null;
}

export interface BookmarkMetadata {
  description?: string;
}

export type BookmarkMetadataMap = Record<string, BookmarkMetadata>;

export interface TimeLogEntry {
  url: string;
  title: string;
  domain: string;
  duration: number;
  date: number;
}

export interface ActiveTrackedSession {
  tabId: number;
  url: string;
  title: string;
  startedAt: number;
}
