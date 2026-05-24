import { useEffect, useState } from 'react';
import './index.css';
import LeftPanel from './components/LeftPanel';
import OrganizePanel from './components/OrganizePanel';
import RightPanel from './components/RightPanel';
import SettingsPanel from './components/SettingsPanel';
import { classifyBookmarksWithDeepSeek } from './lib/deepseek';
import { getAllBookmarks } from './lib/bookmarks';
import {
  clearDeepSeekApiKey,
  defaultBookmarkPanelState,
  defaultUiSettings,
  getAutoClassifyFailedIds,
  getBookmarkMetadata,
  getBookmarkPanelState,
  getDeepSeekApiKey,
  getHiddenLeftPanelDomains,
  getLastUpdateTime,
  getPinnedPages,
  getRawTimeLog,
  getUrlNameCache,
  saveAutoClassifyFailedIds,
  saveBookmarkMetadata,
  saveBookmarkPanelState,
  saveDeepSeekApiKey,
  saveHiddenLeftPanelDomains,
  saveLastUpdateTime,
  savePinnedPages,
  saveRawTimeLog,
  saveUrlNameCache
} from './lib/storage';
import type { AppDataExport, BookmarkItem, FullAiClassificationMode } from './types/app';

interface FullAiClassificationTrigger {
  nonce: number;
  mode: FullAiClassificationMode;
}

export default function App() {
  const [deepseekApiKey, setDeepseekApiKey] = useState('');
  const [hiddenLeftPanelDomains, setHiddenLeftPanelDomains] = useState<string[]>([]);
  const [allBookmarks, setAllBookmarks] = useState<BookmarkItem[]>([]);
  const [fullAiClassificationTrigger, setFullAiClassificationTrigger] = useState<FullAiClassificationTrigger>({
    nonce: 0,
    mode: 'overwrite'
  });
  const [organizeCommand, setOrganizeCommand] = useState<{
    nonce: number;
    action: 'open' | 'create' | 'save' | 'discard';
  }>({
    nonce: 0,
    action: 'open'
  });
  const [organizeState, setOrganizeState] = useState<{
    isDraftMode: boolean;
    statusMessage: string | null;
  }>({
    isDraftMode: false,
    statusMessage: null
  });

  useEffect(() => {
    let isMounted = true;

    async function loadAppState() {
      const [storedApiKey, storedHiddenDomains, bookmarks] = await Promise.all([
        getDeepSeekApiKey(),
        getHiddenLeftPanelDomains(),
        getAllBookmarks()
      ]);

      if (isMounted) {
        setDeepseekApiKey(storedApiKey);
        setHiddenLeftPanelDomains(storedHiddenDomains);
        setAllBookmarks(bookmarks);
      }
    }

    loadAppState();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (typeof chrome === 'undefined' || typeof chrome.storage?.onChanged === 'undefined') {
      return;
    }

    const handleStorageChange = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== 'local') {
        return;
      }

      if (changes.deepseekApiKey) {
        void getDeepSeekApiKey().then((nextApiKey) => {
          setDeepseekApiKey(nextApiKey);
        });
      }

      if (changes.hiddenLeftPanelDomains) {
        void getHiddenLeftPanelDomains().then((nextHiddenDomains) => {
          setHiddenLeftPanelDomains(nextHiddenDomains);
        });
      }
    };

    chrome.storage.onChanged.addListener(handleStorageChange);

    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, []);

  const handleDeepSeekApiKeyChange = async (value: string) => {
    setDeepseekApiKey(value);
    await saveDeepSeekApiKey(value);
  };

  const handleClearDeepSeekApiKey = async () => {
    setDeepseekApiKey('');
    await clearDeepSeekApiKey();
  };

  const handleUnhideLeftPanelDomain = async (domain: string) => {
    const nextDomains = hiddenLeftPanelDomains.filter((item) => item !== domain);
    setHiddenLeftPanelDomains(nextDomains);
    await saveHiddenLeftPanelDomains(nextDomains);
  };

  const handleExportData = async () => {
    const [
      bookmarkPanelState,
      pinnedPages,
      hiddenLeftPanelDomains,
      urlNameCache,
      bookmarkMetadata,
      autoClassifyFailedIds,
      rawTimeLog,
      lastUpdateTime
    ] = await Promise.all([
      getBookmarkPanelState(),
      getPinnedPages(),
      getHiddenLeftPanelDomains(),
      getUrlNameCache(),
      getBookmarkMetadata(),
      getAutoClassifyFailedIds(),
      getRawTimeLog(),
      getLastUpdateTime()
    ]);

    const payload: AppDataExport = {
      version: 1,
      exportedAt: new Date().toISOString(),
      uiSettings: defaultUiSettings,
      bookmarkPanelState,
      pinnedPages,
      hiddenLeftPanelDomains,
      urlNameCache,
      bookmarkMetadata,
      autoClassifyFailedIds,
      rawTimeLog,
      lastUpdateTime,
      deepseekApiKey,
      backgroundImage: null
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = `luma-tab-data-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(blobUrl);
  };

  const handleImportData = async (file: File) => {
    const rawText = await file.text();
    const parsed = JSON.parse(rawText) as Partial<AppDataExport>;

    if (!parsed || parsed.version !== 1 || !parsed.uiSettings) {
      throw new Error('Invalid export file.');
    }

    const nextBookmarkPanelState = {
      ...defaultBookmarkPanelState,
      ...(parsed.bookmarkPanelState ?? defaultBookmarkPanelState)
    };
    const nextPinnedPages = Array.isArray(parsed.pinnedPages) ? parsed.pinnedPages : [];
    const nextHiddenLeftPanelDomains = Array.isArray(parsed.hiddenLeftPanelDomains)
      ? parsed.hiddenLeftPanelDomains.filter((item): item is string => typeof item === 'string')
      : [];
    const nextUrlNameCache = parsed.urlNameCache ?? {};
    const nextBookmarkMetadata = parsed.bookmarkMetadata ?? {};
    const nextAutoClassifyFailedIds = Array.isArray(parsed.autoClassifyFailedIds)
      ? parsed.autoClassifyFailedIds
      : [];
    const nextRawTimeLog = Array.isArray(parsed.rawTimeLog) ? parsed.rawTimeLog : [];
    const nextLastUpdateTime = typeof parsed.lastUpdateTime === 'number' ? parsed.lastUpdateTime : 0;
    const nextApiKey = typeof parsed.deepseekApiKey === 'string' ? parsed.deepseekApiKey : '';

    await Promise.all([
      saveBookmarkPanelState(nextBookmarkPanelState),
      savePinnedPages(nextPinnedPages),
      saveHiddenLeftPanelDomains(nextHiddenLeftPanelDomains),
      saveUrlNameCache(nextUrlNameCache),
      saveBookmarkMetadata(nextBookmarkMetadata),
      saveAutoClassifyFailedIds(nextAutoClassifyFailedIds),
      saveRawTimeLog(nextRawTimeLog),
      saveLastUpdateTime(nextLastUpdateTime),
      saveDeepSeekApiKey(nextApiKey)
    ]);

    setDeepseekApiKey(nextApiKey);
    setHiddenLeftPanelDomains(nextHiddenLeftPanelDomains);
    setAllBookmarks(await getAllBookmarks());
  };

  const handleValidateDeepSeekPrompt = async () => {
    const sampleBookmarks = allBookmarks.slice(0, 8);

    if (sampleBookmarks.length === 0) {
      throw new Error('No bookmarks.');
    }

    const result = await classifyBookmarksWithDeepSeek(deepseekApiKey, sampleBookmarks);
    const categoryCount = Object.keys(result).length;

    return `Checked: ${categoryCount} groups.`;
  };

  const handleRunFullAiClassification = async (mode: FullAiClassificationMode) => {
    if (!deepseekApiKey.trim()) {
      throw new Error('Add API key first.');
    }

    setFullAiClassificationTrigger((current) => ({
      nonce: current.nonce + 1,
      mode
    }));
    return mode === 'overwrite'
      ? 'AI regrouping all bookmarks...'
      : 'AI grouping ungrouped bookmarks...';
  };

  const dispatchOrganizeCommand = (action: 'open' | 'create' | 'save' | 'discard') => {
    setOrganizeCommand((current) => ({
      nonce: current.nonce + 1,
      action
    }));
  };

  return (
    <div className="app-shell">
      <div className="page-background" />
      <SettingsPanel
        deepseekApiKey={deepseekApiKey}
        hiddenLeftPanelDomains={hiddenLeftPanelDomains}
        onDeepSeekApiKeyChange={handleDeepSeekApiKeyChange}
        onClearDeepSeekApiKey={handleClearDeepSeekApiKey}
        onUnhideLeftPanelDomain={handleUnhideLeftPanelDomain}
        onExportData={handleExportData}
        onImportData={handleImportData}
      />
      <OrganizePanel
        isDraftMode={organizeState.isDraftMode}
        statusMessage={organizeState.statusMessage}
        onOpenDraftMode={() => dispatchOrganizeCommand('open')}
        onCreateCategory={() => dispatchOrganizeCommand('create')}
        onSaveCategories={() => dispatchOrganizeCommand('save')}
        onDiscardDraft={() => dispatchOrganizeCommand('discard')}
        onValidateDeepSeekPrompt={handleValidateDeepSeekPrompt}
        onRunFullAiClassification={handleRunFullAiClassification}
      />
      <div className="app-panels">
        <section className="glass-panel app-panel left-panel-shell">
          <LeftPanel />
        </section>
        <section className="glass-panel app-panel right-panel-shell">
          <RightPanel
            deepseekApiKey={deepseekApiKey}
            fullAiClassificationTrigger={fullAiClassificationTrigger}
            organizeCommand={organizeCommand}
            onOrganizeStateChange={setOrganizeState}
          />
        </section>
      </div>
    </div>
  );
}
