import { Settings2, X } from 'lucide-react';
import { type WheelEvent as ReactWheelEvent, useEffect, useRef, useState } from 'react';

interface SettingsPanelProps {
  deepseekApiKey: string;
  hiddenLeftPanelDomains: string[];
  onDeepSeekApiKeyChange: (value: string) => Promise<void>;
  onClearDeepSeekApiKey: () => Promise<void>;
  onUnhideLeftPanelDomain: (domain: string) => Promise<void>;
  onExportData: () => Promise<void>;
  onImportData: (file: File) => Promise<void>;
}

export default function SettingsPanel({
  deepseekApiKey,
  hiddenLeftPanelDomains,
  onDeepSeekApiKeyChange,
  onClearDeepSeekApiKey,
  onUnhideLeftPanelDomain,
  onExportData,
  onImportData
}: SettingsPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
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
                  <div className="settings-section-title">Left Sidebar Hidden Domains</div>
                  <div className="settings-section-description">
                    Hidden domains will not appear in Common Entrances or Continue Browsing.
                  </div>
                </div>
                <div className="settings-actions-column">
                  {hiddenLeftPanelDomains.length > 0 ? (
                    <div className="settings-token-list">
                      {hiddenLeftPanelDomains.map((domain) => (
                        <div key={domain} className="settings-token-row">
                          <span className="settings-token-label">{domain}</span>
                          <button
                            type="button"
                            className="settings-secondary-button settings-token-button"
                            onClick={() => void onUnhideLeftPanelDomain(domain)}
                          >
                            Unhide
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="settings-note">No hidden domains yet.</div>
                  )}
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
