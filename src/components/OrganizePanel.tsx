import { SlidersHorizontal, X } from 'lucide-react';
import { type WheelEvent as ReactWheelEvent, useEffect, useRef, useState } from 'react';
import type { FullAiClassificationMode } from '../types/app';

interface OrganizePanelProps {
  isDraftMode: boolean;
  statusMessage: string | null;
  onOpenDraftMode: () => void;
  onCreateCategory: () => void;
  onSaveCategories: () => void;
  onDiscardDraft: () => void;
  onValidateDeepSeekPrompt: () => Promise<string>;
  onRunFullAiClassification: (mode: FullAiClassificationMode) => Promise<string>;
}

export default function OrganizePanel({
  isDraftMode,
  statusMessage,
  onOpenDraftMode,
  onCreateCategory,
  onSaveCategories,
  onDiscardDraft,
  onValidateDeepSeekPrompt,
  onRunFullAiClassification
}: OrganizePanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [classificationMode, setClassificationMode] = useState<FullAiClassificationMode>('overwrite');
  const [localStatus, setLocalStatus] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isRunningClassification, setIsRunningClassification] = useState(false);
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
    if (statusMessage) {
      setLocalStatus(statusMessage);
    }
  }, [statusMessage]);

  const closeOrganizer = () => {
    onDiscardDraft();
    setIsOpen(false);
  };

  const handleDiscardDraft = () => {
    onDiscardDraft();
    setIsOpen(false);
  };

  const handleSaveCategories = () => {
    onSaveCategories();
    setIsOpen(false);
  };

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    document.documentElement.classList.add('popover-scroll-lock');
    document.body.classList.add('popover-scroll-lock');

    const handleSettingsOpened = () => {
      closeOrganizer();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeOrganizer();
      }
    };

    window.addEventListener('luma:settings-opened', handleSettingsOpened);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.documentElement.classList.remove('popover-scroll-lock');
      document.body.classList.remove('popover-scroll-lock');
      window.removeEventListener('luma:settings-opened', handleSettingsOpened);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, isDraftMode, onDiscardDraft]);

  const handleOpen = () => {
    if (isOpen) {
      closeOrganizer();
      return;
    }

    if (!isDraftMode) {
      onOpenDraftMode();
    }

    setIsOpen(true);
  };

  const handleValidate = async () => {
    setIsValidating(true);

    try {
      const message = await onValidateDeepSeekPrompt();
      setLocalStatus(message);
    } catch (error) {
      setLocalStatus(error instanceof Error ? error.message : 'Validate failed.');
    } finally {
      setIsValidating(false);
    }
  };

  const handleRunClassification = async () => {
    setIsRunningClassification(true);

    try {
      const message = await onRunFullAiClassification(classificationMode);
      setLocalStatus(message);
    } catch (error) {
      setLocalStatus(error instanceof Error ? error.message : 'AI start failed.');
    } finally {
      setIsRunningClassification(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="floating-mode-trigger"
        aria-label="Open editor"
        title="Open editor"
        onClick={handleOpen}
      >
        <SlidersHorizontal size={18} strokeWidth={1.8} />
      </button>

      {isOpen ? (
        <>
          <div className="organize-popover glass-panel">
            <div ref={shellRef} className="organize-shell" onWheelCapture={containPopoverScroll}>
              <div className="organize-header">
                <div className="organize-title">Edit</div>
                <button
                  type="button"
                  className="organize-close"
                  aria-label="Close editor"
                  onClick={closeOrganizer}
                >
                  <X size={16} strokeWidth={1.9} />
                </button>
              </div>
              <div className="organize-actions">
                <button type="button" className="bookmark-primary-button" onClick={onCreateCategory}>
                  New Group
                </button>
                <button type="button" className="bookmark-primary-button" onClick={handleSaveCategories}>
                  Save
                </button>
                <button type="button" className="bookmark-secondary-button" onClick={handleDiscardDraft}>
                  Cancel
                </button>
              </div>
              <div className="organize-divider" />
              <div className="organize-section-title">AI</div>
              <div className="settings-mode-group">
                <label className="settings-radio">
                  <input
                    type="radio"
                    name="organize-ai-classification-mode"
                    checked={classificationMode === 'overwrite'}
                    onChange={() => setClassificationMode('overwrite')}
                  />
                  <span>Sort all</span>
                </label>
                <label className="settings-radio">
                  <input
                    type="radio"
                    name="organize-ai-classification-mode"
                    checked={classificationMode === 'unclassified_only'}
                    onChange={() => setClassificationMode('unclassified_only')}
                  />
                  <span>Sort ungrouped</span>
                </label>
              </div>
              <div className="organize-actions">
                <button
                  type="button"
                  className="bookmark-secondary-button"
                  onClick={() => void handleValidate()}
                  disabled={isValidating}
                >
                  {isValidating ? 'Checking...' : 'Check'}
                </button>
                <button
                  type="button"
                  className="bookmark-primary-button"
                  onClick={() => void handleRunClassification()}
                  disabled={isRunningClassification}
                >
                  {isRunningClassification ? 'Running...' : 'Run'}
                </button>
              </div>
              {localStatus ? <div className="settings-status">{localStatus}</div> : null}
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
