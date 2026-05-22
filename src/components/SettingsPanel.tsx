import { Settings2, X } from 'lucide-react';
import { type WheelEvent as ReactWheelEvent, useEffect, useRef, useState } from 'react';
import type { UiSettings } from '../types/app';

const themeColorOptions: Array<{
  id: UiSettings['backgroundPrimary'];
  label: string;
  swatch: string;
}> = [
  { id: 'none', label: 'None', swatch: '#f4f6f8' },
  { id: 'mist', label: 'Mist', swatch: '#eef3f8' },
  { id: 'sky', label: 'Sky', swatch: '#d9eafb' },
  { id: 'ocean', label: 'Ocean', swatch: '#b9d8e6' },
  { id: 'teal', label: 'Teal', swatch: '#bddfdc' },
  { id: 'mint', label: 'Mint', swatch: '#cfe8dc' },
  { id: 'sage', label: 'Sage', swatch: '#d9e5d5' },
  { id: 'lavender', label: 'Lavender', swatch: '#dddaf0' },
  { id: 'pearl', label: 'Pearl', swatch: '#e8e5df' }
];

interface SettingsPanelProps {
  settings: UiSettings;
  onSettingsChange: (nextSettings: UiSettings) => Promise<void>;
  hasBackgroundImage: boolean;
  onBackgroundUpload: (file: File) => Promise<void>;
  onBackgroundRemove: () => Promise<void>;
  onResetDisplay: () => Promise<void>;
  deepseekApiKey: string;
  onDeepSeekApiKeyChange: (value: string) => Promise<void>;
  onClearDeepSeekApiKey: () => Promise<void>;
  onExportData: () => Promise<void>;
  onImportData: (file: File) => Promise<void>;
}

export default function SettingsPanel({
  settings,
  onSettingsChange,
  hasBackgroundImage,
  onBackgroundUpload,
  onBackgroundRemove,
  onResetDisplay,
  deepseekApiKey,
  onDeepSeekApiKeyChange,
  onClearDeepSeekApiKey,
  onExportData,
  onImportData
}: SettingsPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [apiKeyValue, setApiKeyValue] = useState(deepseekApiKey);
  const [isSavingApiKey, setIsSavingApiKey] = useState(false);
  const [isClearingApiKey, setIsClearingApiKey] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const shellRef = useRef<HTMLDivElement | null>(null);

  const nudgePopoverContent = (direction: 'up' | 'down') => {
    const element = shellRef.current;

    if (!element) {
      return;
    }

    element.classList.remove('popover-bump-up', 'popover-bump-down');
    void element.offsetWidth;
    element.classList.add(direction === 'up' ? 'popover-bump-up' : 'popover-bump-down');

    window.setTimeout(() => {
      element.classList.remove('popover-bump-up', 'popover-bump-down');
    }, 180);
  };

  const containPopoverScroll = (event: ReactWheelEvent<HTMLDivElement>) => {
    const element = event.currentTarget;

    if (element.scrollHeight <= element.clientHeight) {
      nudgePopoverContent(event.deltaY < 0 ? 'down' : 'up');
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const nextScrollTop = Math.max(
      0,
      Math.min(element.scrollTop + event.deltaY, element.scrollHeight - element.clientHeight)
    );

    if (nextScrollTop !== element.scrollTop) {
      element.scrollTop = nextScrollTop;
    } else {
      nudgePopoverContent(event.deltaY < 0 ? 'down' : 'up');
    }

    event.preventDefault();
    event.stopPropagation();
  };

  useEffect(() => {
    setApiKeyValue(deepseekApiKey);
  }, [deepseekApiKey]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    window.dispatchEvent(new CustomEvent('luma:settings-opened'));
    document.documentElement.classList.add('popover-scroll-lock');
    document.body.classList.add('popover-scroll-lock');

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.documentElement.classList.remove('popover-scroll-lock');
      document.body.classList.remove('popover-scroll-lock');
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    setIsUploading(true);
    setStatus(null);

    try {
      await onBackgroundUpload(file);
      setStatus('Image updated.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Upload failed.');
    } finally {
      setIsUploading(false);
      event.target.value = '';
    }
  };

  const handleRemoveClick = async () => {
    setStatus(null);

    try {
      await onBackgroundRemove();
      setStatus('Image removed.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Remove failed.');
    }
  };

  const handleApiKeySave = async () => {
    setIsSavingApiKey(true);

    try {
      await onDeepSeekApiKeyChange(apiKeyValue);
      setStatus('API key saved.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Save failed.');
    } finally {
      setIsSavingApiKey(false);
    }
  };

  const handleApiKeyClear = async () => {
    setIsClearingApiKey(true);

    try {
      await onClearDeepSeekApiKey();
      setApiKeyValue('');
      setStatus('API key cleared.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Clear failed.');
    } finally {
      setIsClearingApiKey(false);
    }
  };

  const updateSettings = async (partial: Partial<UiSettings>) => {
    await onSettingsChange({
      ...settings,
      ...partial
    });
  };

  const handleExportClick = async () => {
    setIsExporting(true);

    try {
      await onExportData();
      setStatus('Exported.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Export failed.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleImportFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    setIsImporting(true);

    try {
      await onImportData(file);
      setStatus('Imported.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Import failed.');
    } finally {
      setIsImporting(false);
      event.target.value = '';
    }
  };

  return (
    <>
      <button
        type="button"
        className="settings-trigger"
        aria-label="Open settings"
        onClick={() => setIsOpen((current) => !current)}
      >
        <Settings2 size={18} strokeWidth={1.8} />
      </button>

      {isOpen ? (
        <>
          <button
            type="button"
            className="settings-backdrop"
            aria-label="Close settings"
            onClick={() => setIsOpen(false)}
          />
          <div className="settings-popover glass-panel">
            <div ref={shellRef} className="settings-shell" onWheelCapture={containPopoverScroll}>
              <div className="settings-header">
                <div>
                  <div className="settings-title">Settings</div>
                </div>
                <button
                  type="button"
                  className="settings-close"
                  aria-label="Close settings"
                  onClick={() => setIsOpen(false)}
                >
                  <X size={16} strokeWidth={1.9} />
                </button>
              </div>

              <section className="settings-section">
                <div className="settings-section-header">
                  <div className="settings-section-title">API</div>
                </div>
                <div className="settings-actions-column">
                  <input
                    className="settings-text-input"
                    type="password"
                    value={apiKeyValue}
                    placeholder="DeepSeek API key"
                    onChange={(event) => setApiKeyValue(event.target.value)}
                  />
                  <div className="settings-button-grid">
                    <button
                      type="button"
                      className="settings-secondary-button"
                      onClick={() => void handleApiKeySave()}
                      disabled={isSavingApiKey}
                    >
                      {isSavingApiKey ? 'Saving...' : 'Save Key'}
                    </button>
                    <button
                      type="button"
                      className="settings-secondary-button"
                      onClick={() => void handleApiKeyClear()}
                      disabled={isClearingApiKey}
                    >
                      {isClearingApiKey ? 'Clearing...' : 'Clear Key'}
                    </button>
                  </div>
                </div>
              </section>

              <section className="settings-section">
                <div className="settings-section-header">
                  <div className="settings-section-title">Data</div>
                </div>

                <div className="settings-actions-column">
                  <div className="settings-button-grid">
                    <button
                      type="button"
                      className="settings-secondary-button"
                      onClick={() => void handleExportClick()}
                      disabled={isExporting}
                    >
                      {isExporting ? 'Exporting...' : 'Export'}
                    </button>
                    <label className="settings-secondary-button settings-import-button">
                      <span>{isImporting ? 'Importing...' : 'Import'}</span>
                      <input
                        type="file"
                        accept="application/json"
                        onChange={handleImportFileChange}
                        disabled={isImporting}
                        style={{ display: 'none' }}
                      />
                    </label>
                  </div>
                </div>
              </section>

              <section className="settings-section">
                <div className="settings-section-header">
                  <div className="settings-section-title">Display</div>
                </div>

                <label className="settings-field">
                  <span className="settings-field-label">
                    Opacity {Math.round(settings.opacity * 100)}%
                  </span>
                  <input
                    type="range"
                    min="0.2"
                    max="1"
                    step="0.01"
                    value={settings.opacity}
                    onChange={(event) => void updateSettings({ opacity: Number(event.target.value) })}
                  />
                </label>

                <label className="settings-field">
                  <span className="settings-field-label">
                    Brightness {settings.brightness}%
                  </span>
                  <input
                    type="range"
                    min="85"
                    max="115"
                    step="1"
                    value={settings.brightness}
                    onChange={(event) => void updateSettings({ brightness: Number(event.target.value) })}
                  />
                </label>

                <button
                  type="button"
                  className="settings-secondary-button"
                  onClick={() => void onResetDisplay().then(() => setStatus('Display reset.'))}
                >
                  Reset Display
                </button>
              </section>

              <section className="settings-section settings-section-compact">
                <div className="settings-section-header">
                  <div className="settings-section-title">Background</div>
                </div>

                <div className="settings-field">
                  <span className="settings-field-label">Style</span>
                  <div className="settings-inline-options">
                    <button
                      type="button"
                      className={`settings-chip${settings.backgroundStyle === 'solid' ? ' active' : ''}`}
                      onClick={() => void updateSettings({ backgroundStyle: 'solid' })}
                    >
                      Solid
                    </button>
                    <button
                      type="button"
                      className={`settings-chip${settings.backgroundStyle === 'gradient' ? ' active' : ''}`}
                      onClick={() => void updateSettings({ backgroundStyle: 'gradient' })}
                    >
                      Gradient
                    </button>
                  </div>
                </div>

                <div className="settings-field">
                  <span className="settings-field-label">Colors</span>
                  <div className="settings-color-grid compact">
                    {themeColorOptions.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        className={`settings-color-swatch${settings.backgroundPrimary === option.id ? ' active' : ''}`}
                        title={option.label}
                        aria-label={option.label}
                        onClick={() => void updateSettings({ backgroundPrimary: option.id })}
                        style={{
                          background: option.id === 'none'
                            ? 'linear-gradient(135deg, #f8fafc 0%, #edf2f7 100%)'
                            : option.swatch
                        }}
                      />
                    ))}
                  </div>
                </div>

                {settings.backgroundStyle === 'gradient' ? (
                  <div className="settings-field">
                    <span className="settings-field-label">Accent</span>
                    <div className="settings-color-grid compact">
                      {themeColorOptions.map((option) => (
                        <button
                          key={`secondary-${option.id}`}
                          type="button"
                          className={`settings-color-swatch${settings.backgroundSecondary === option.id ? ' active' : ''}`}
                          title={option.label}
                          aria-label={option.label}
                          onClick={() => void updateSettings({ backgroundSecondary: option.id })}
                          style={{
                            background: option.id === 'none'
                              ? 'linear-gradient(135deg, #f8fafc 0%, #edf2f7 100%)'
                              : option.swatch
                          }}
                        />
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="settings-button-grid compact">
                  <label className="settings-upload">
                    <span>{isUploading ? 'Uploading...' : 'Upload Image'}</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleFileChange}
                      disabled={isUploading}
                      style={{ display: 'none' }}
                    />
                  </label>
                  <button
                    type="button"
                    className="settings-secondary-button"
                    onClick={handleRemoveClick}
                    disabled={!hasBackgroundImage}
                  >
                    {hasBackgroundImage ? 'Remove Image' : 'No Image'}
                  </button>
                </div>
              </section>

              {status ? <div className="settings-status">{status}</div> : null}
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
