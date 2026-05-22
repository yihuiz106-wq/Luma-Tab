import { useEffect, useState } from 'react';
import './index.css';
import LeftPanel from './components/LeftPanel';
import OrganizePanel from './components/OrganizePanel';
import RightPanel from './components/RightPanel';
import SettingsPanel from './components/SettingsPanel';
import {
  getBackgroundImage,
  removeBackgroundImage,
  saveBackgroundImage,
  saveBackgroundImageDataUrl
} from './lib/backgroundImage';
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
  getLastUpdateTime,
  getPinnedPages,
  getRawTimeLog,
  getUiSettings,
  getUrlNameCache,
  saveAutoClassifyFailedIds,
  saveBookmarkMetadata,
  saveBookmarkPanelState,
  saveDeepSeekApiKey,
  saveLastUpdateTime,
  savePinnedPages,
  saveRawTimeLog,
  saveUiSettings,
  saveUrlNameCache
} from './lib/storage';
import type { AppDataExport, BookmarkItem, FullAiClassificationMode, UiSettings } from './types/app';

interface FullAiClassificationTrigger {
  nonce: number;
  mode: FullAiClassificationMode;
}

function clampBrightness(value: number) {
  return Math.min(115, Math.max(85, value));
}

function getBackgroundStyle(settings: UiSettings) {
  const brightness = clampBrightness(settings.brightness);
  const filter = `brightness(${brightness}%)`;

  const colors: Record<UiSettings['backgroundPrimary'], string> = {
    none: '#f4f6f8',
    mist: '#eef3f8',
    sky: '#d9eafb',
    ocean: '#b9d8e6',
    teal: '#bddfdc',
    mint: '#cfe8dc',
    sage: '#d9e5d5',
    lavender: '#dddaf0',
    pearl: '#e8e5df'
  };

  const primary = colors[settings.backgroundPrimary];
  const secondary = colors[settings.backgroundSecondary];
  const gradient = `linear-gradient(225deg, ${primary} 0%, ${mixHex(primary, secondary, 0.45)} 46%, ${secondary} 100%)`;

  return {
    filter,
    solidColor: primary,
    gradientImage: gradient
  };
}

function mixHex(colorA: string, colorB: string, weight: number) {
  const a = colorA.replace('#', '');
  const b = colorB.replace('#', '');
  const ratio = Math.min(1, Math.max(0, weight));

  const mixed = [0, 1, 2]
    .map((index) => {
      const start = parseInt(a.slice(index * 2, index * 2 + 2), 16);
      const end = parseInt(b.slice(index * 2, index * 2 + 2), 16);
      const value = Math.round(start + (end - start) * ratio);
      return value.toString(16).padStart(2, '0');
    })
    .join('');

  return `#${mixed}`;
}

export default function App() {
  const [uiSettings, setUiSettings] = useState<UiSettings>(defaultUiSettings);
  const [backgroundImage, setBackgroundImage] = useState<string | null>(null);
  const [deepseekApiKey, setDeepseekApiKey] = useState('');
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
  const backgroundTheme = getBackgroundStyle(uiSettings);

  useEffect(() => {
    let isMounted = true;

    async function loadAppState() {
      const [storedSettings, storedBackgroundImage, storedApiKey, bookmarks] = await Promise.all([
        getUiSettings(),
        getBackgroundImage(),
        getDeepSeekApiKey(),
        getAllBookmarks()
      ]);

      if (isMounted) {
        setUiSettings(storedSettings);
        setBackgroundImage(storedBackgroundImage);
        setDeepseekApiKey(storedApiKey);
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

      if (changes.uiSettings?.newValue) {
        setUiSettings(changes.uiSettings.newValue as UiSettings);
      }

      if (changes.deepseekApiKey) {
        void getDeepSeekApiKey().then((nextApiKey) => {
          setDeepseekApiKey(nextApiKey);
        });
      }
    };

    chrome.storage.onChanged.addListener(handleStorageChange);

    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, []);

  const handleSettingsChange = async (nextSettings: UiSettings) => {
    setUiSettings(nextSettings);
    await saveUiSettings(nextSettings);
  };

  const handleBackgroundUpload = async (file: File) => {
    const nextImage = await saveBackgroundImage(file);
    setBackgroundImage(nextImage);
  };

  const handleBackgroundRemove = async () => {
    await removeBackgroundImage();
    setBackgroundImage(null);
  };

  const handleResetDisplay = async () => {
    setUiSettings(defaultUiSettings);
    await saveUiSettings(defaultUiSettings);
  };

  const handleDeepSeekApiKeyChange = async (value: string) => {
    setDeepseekApiKey(value);
    await saveDeepSeekApiKey(value);
  };

  const handleClearDeepSeekApiKey = async () => {
    setDeepseekApiKey('');
    await clearDeepSeekApiKey();
  };

  const handleExportData = async () => {
    const [
      bookmarkPanelState,
      pinnedPages,
      urlNameCache,
      bookmarkMetadata,
      autoClassifyFailedIds,
      rawTimeLog,
      lastUpdateTime,
      currentBackgroundImage
    ] = await Promise.all([
      getBookmarkPanelState(),
      getPinnedPages(),
      getUrlNameCache(),
      getBookmarkMetadata(),
      getAutoClassifyFailedIds(),
      getRawTimeLog(),
      getLastUpdateTime(),
      getBackgroundImage()
    ]);

    const payload: AppDataExport = {
      version: 1,
      exportedAt: new Date().toISOString(),
      uiSettings,
      bookmarkPanelState,
      pinnedPages,
      urlNameCache,
      bookmarkMetadata,
      autoClassifyFailedIds,
      rawTimeLog,
      lastUpdateTime,
      deepseekApiKey,
      backgroundImage: currentBackgroundImage
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

    const nextUiSettings = {
      ...defaultUiSettings,
      ...parsed.uiSettings
    };
    const nextBookmarkPanelState = {
      ...defaultBookmarkPanelState,
      ...(parsed.bookmarkPanelState ?? defaultBookmarkPanelState)
    };
    const nextPinnedPages = Array.isArray(parsed.pinnedPages) ? parsed.pinnedPages : [];
    const nextUrlNameCache = parsed.urlNameCache ?? {};
    const nextBookmarkMetadata = parsed.bookmarkMetadata ?? {};
    const nextAutoClassifyFailedIds = Array.isArray(parsed.autoClassifyFailedIds)
      ? parsed.autoClassifyFailedIds
      : [];
    const nextRawTimeLog = Array.isArray(parsed.rawTimeLog) ? parsed.rawTimeLog : [];
    const nextLastUpdateTime = typeof parsed.lastUpdateTime === 'number' ? parsed.lastUpdateTime : 0;
    const nextApiKey = typeof parsed.deepseekApiKey === 'string' ? parsed.deepseekApiKey : '';
    const nextBackgroundImage = typeof parsed.backgroundImage === 'string' ? parsed.backgroundImage : null;

    await Promise.all([
      saveUiSettings(nextUiSettings),
      saveBookmarkPanelState(nextBookmarkPanelState),
      savePinnedPages(nextPinnedPages),
      saveUrlNameCache(nextUrlNameCache),
      saveBookmarkMetadata(nextBookmarkMetadata),
      saveAutoClassifyFailedIds(nextAutoClassifyFailedIds),
      saveRawTimeLog(nextRawTimeLog),
      saveLastUpdateTime(nextLastUpdateTime),
      saveDeepSeekApiKey(nextApiKey)
    ]);

    if (nextBackgroundImage) {
      await saveBackgroundImageDataUrl(nextBackgroundImage);
    } else {
      await removeBackgroundImage();
    }

    setUiSettings(nextUiSettings);
    setDeepseekApiKey(nextApiKey);
    setBackgroundImage(nextBackgroundImage);
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
      <div
        className={`page-background${backgroundImage ? ' has-image' : ''}`}
        style={{
          opacity: uiSettings.opacity,
          filter: backgroundTheme.filter,
          backgroundColor: backgroundImage || uiSettings.backgroundStyle === 'gradient'
            ? backgroundTheme.solidColor
            : backgroundTheme.solidColor,
          backgroundImage: backgroundImage
            ? `url("${backgroundImage}")`
            : uiSettings.backgroundStyle === 'gradient'
              ? backgroundTheme.gradientImage
              : 'none'
        }}
      />
      <SettingsPanel
        settings={uiSettings}
        onSettingsChange={handleSettingsChange}
        hasBackgroundImage={Boolean(backgroundImage)}
        onBackgroundUpload={handleBackgroundUpload}
        onBackgroundRemove={handleBackgroundRemove}
        onResetDisplay={handleResetDisplay}
        deepseekApiKey={deepseekApiKey}
        onDeepSeekApiKeyChange={handleDeepSeekApiKeyChange}
        onClearDeepSeekApiKey={handleClearDeepSeekApiKey}
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
