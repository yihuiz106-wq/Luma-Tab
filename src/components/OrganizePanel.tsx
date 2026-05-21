import { SlidersHorizontal, X } from 'lucide-react';
import { useEffect, useState } from 'react';
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

  useEffect(() => {
    if (statusMessage) {
      setLocalStatus(statusMessage);
    }
  }, [statusMessage]);

  const closeOrganizer = () => {
    if (isDraftMode) {
      onDiscardDraft();
    }

    setIsOpen(false);
  };

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeOrganizer();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, isDraftMode]);

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
      setLocalStatus(error instanceof Error ? error.message : 'DeepSeek validation failed.');
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
      setLocalStatus(error instanceof Error ? error.message : 'Failed to start AI classification.');
    } finally {
      setIsRunningClassification(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="floating-mode-trigger"
        aria-label="Open organize tools"
        title="Open organize tools"
        onClick={handleOpen}
      >
        <SlidersHorizontal size={18} strokeWidth={1.8} />
      </button>

      {isOpen ? (
        <>
          <div className="organize-popover glass-panel">
            <div className="organize-shell">
              <div className="organize-header">
                <div className="organize-title">Organize</div>
                <button
                  type="button"
                  className="organize-close"
                  aria-label="Close organize tools"
                  onClick={closeOrganizer}
                >
                  <X size={16} strokeWidth={1.9} />
                </button>
              </div>
              <div className="organize-actions">
                <button type="button" className="bookmark-primary-button" onClick={onCreateCategory}>
                  Create Category
                </button>
                <button type="button" className="bookmark-primary-button" onClick={onSaveCategories}>
                  Save Categories
                </button>
                <button type="button" className="bookmark-secondary-button" onClick={closeOrganizer}>
                  Discard Draft
                </button>
              </div>
              <div className="organize-divider" />
              <div className="organize-section-title">AI Classification</div>
              <div className="settings-mode-group">
                <label className="settings-radio">
                  <input
                    type="radio"
                    name="organize-ai-classification-mode"
                    checked={classificationMode === 'overwrite'}
                    onChange={() => setClassificationMode('overwrite')}
                  />
                  <span>Reclassify All Bookmarks</span>
                </label>
                <label className="settings-radio">
                  <input
                    type="radio"
                    name="organize-ai-classification-mode"
                    checked={classificationMode === 'unclassified_only'}
                    onChange={() => setClassificationMode('unclassified_only')}
                  />
                  <span>Add Unclassified to Existing Categories</span>
                </label>
              </div>
              <div className="organize-actions">
                <button
                  type="button"
                  className="bookmark-secondary-button"
                  onClick={() => void handleValidate()}
                  disabled={isValidating}
                >
                  {isValidating ? 'Validating...' : 'Validate'}
                </button>
                <button
                  type="button"
                  className="bookmark-primary-button"
                  onClick={() => void handleRunClassification()}
                  disabled={isRunningClassification}
                >
                  {isRunningClassification ? 'Processing...' : 'Run AI'}
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
