import {
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { MoreHorizontal, PencilLine, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import FaviconImage from './FaviconImage';
import { getAllBookmarks, removeBookmark } from '../lib/bookmarks';
import {
  getAutoClassifyFailedIds,
  getAutoClassifyNotice,
  getBookmarkMetadata,
  getBookmarkPanelState,
  getUrlNameCache,
  saveAutoClassifyNotice,
  saveBookmarkMetadata,
  saveBookmarkPanelState,
  saveUrlNameCache
} from '../lib/storage';
import { classifyBookmarksWithDeepSeek } from '../lib/deepseek';
import type {
  BookmarkCategory,
  BookmarkMetadataMap,
  BookmarkItem,
  FullAiClassificationMode,
  VirtualBookmarkCategory
} from '../types/app';

const UNCLASSIFIED_CATEGORY_ID = 'unclassified';
const UNCLASSIFIED_CATEGORY_TITLE = 'Unclassified';

interface SortableCategorySectionProps {
  category: BookmarkCategory;
  isExpanded: boolean;
  dragEnabled: boolean;
  isDraftMode: boolean;
  isEditing: boolean;
  editingTitle: string;
  isAiGeneratedCategory: boolean;
  aiSuggestedBookmarkIds: Set<string>;
  autoClassifyFailedIds: Set<string>;
  showAiReviewActions: boolean;
  onToggle: (categoryId: string) => void;
  onOpenBookmark: (url: string) => void;
  onStartEdit: (category: BookmarkCategory) => void;
  onChangeEditingTitle: (value: string) => void;
  onCommitEdit: () => void;
  onDeleteCategory: (categoryId: string) => void;
  onAcceptAiCategory: (categoryId: string) => void;
  onRejectAiCategory: (categoryId: string) => void;
  getDisplayTitle: (bookmark: BookmarkItem) => string;
  getBookmarkDescription: (bookmarkId: string) => string;
  editorBookmarkId: string | null;
  editorState: { title: string; url: string; description: string };
  onOpenBookmarkEditor: (bookmark: BookmarkItem) => void;
  onChangeBookmarkEditor: (field: 'title' | 'url' | 'description', value: string) => void;
  onSaveBookmarkEditor: (bookmark: BookmarkItem) => void;
  onCloseBookmarkEditor: () => void;
  onDiscardBookmarkEditor: () => void;
  onDeleteBookmark: (bookmark: BookmarkItem) => void;
}

interface SortableBookmarkCardProps {
  bookmark: BookmarkItem;
  categoryId: string;
  dragEnabled: boolean;
  onOpen: (url: string) => void;
  isAiSuggested: boolean;
  isAutoClassifyFailed: boolean;
  displayTitle: string;
  description: string;
  isEditorOpen: boolean;
  editorState: { title: string; url: string; description: string };
  onOpenEditor: (bookmark: BookmarkItem) => void;
  onChangeEditor: (field: 'title' | 'url' | 'description', value: string) => void;
  onSaveEditor: (bookmark: BookmarkItem) => void;
  onCloseEditor: () => void;
  onDiscardEditor: () => void;
  onDeleteBookmark: (bookmark: BookmarkItem) => void;
}

interface RightPanelProps {
  deepseekApiKey: string;
  fullAiClassificationTrigger: {
    nonce: number;
    mode: FullAiClassificationMode;
  };
  organizeCommand: {
    nonce: number;
    action: 'open' | 'create' | 'save' | 'discard';
  };
  onOrganizeStateChange: (state: { isDraftMode: boolean; statusMessage: string | null }) => void;
}

function cloneVirtualCategories(categories: VirtualBookmarkCategory[]) {
  return categories.map((category) => ({
    ...category,
    bookmarkIds: [...category.bookmarkIds]
  }));
}

function buildDraftCategoriesFromClassification(
  result: Record<string, string[]>,
  bookmarks: BookmarkItem[]
): VirtualBookmarkCategory[] {
  return Object.entries(result)
    .filter(([categoryTitle]) => categoryTitle !== 'Unclassified')
    .map(([categoryTitle, urls], index) => {
      const bookmarkIds = bookmarks
        .filter((bookmark) => urls.includes(bookmark.url))
        .map((bookmark) => bookmark.id);

      return {
        id: `ai-draft-${Date.now()}-${index}`,
        title: categoryTitle,
        bookmarkIds
      };
    })
    .filter((category) => category.bookmarkIds.length > 0);
}

function buildViewCategories(
  allBookmarks: BookmarkItem[],
  virtualCategories: VirtualBookmarkCategory[]
): BookmarkCategory[] {
  const bookmarksById = new Map(allBookmarks.map((bookmark) => [bookmark.id, bookmark]));
  const assignedIds = new Set<string>();

  const categories: BookmarkCategory[] = virtualCategories.map((category) => {
    const bookmarks = category.bookmarkIds
      .map((bookmarkId) => bookmarksById.get(bookmarkId))
      .filter((bookmark): bookmark is BookmarkItem => Boolean(bookmark));

    for (const bookmark of bookmarks) {
      assignedIds.add(bookmark.id);
    }

    return {
      id: category.id,
      title: category.title,
      bookmarks,
      isVirtual: true
    };
  });

  const unclassifiedBookmarks = allBookmarks.filter((bookmark) => !assignedIds.has(bookmark.id));

  categories.push({
    id: UNCLASSIFIED_CATEGORY_ID,
    title: UNCLASSIFIED_CATEGORY_TITLE,
    bookmarks: unclassifiedBookmarks,
    isSystem: true
  });

  return categories;
}

function SortableBookmarkCard({
  bookmark,
  categoryId,
  dragEnabled,
  onOpen,
  isAiSuggested,
  isAutoClassifyFailed,
  displayTitle,
  description,
  isEditorOpen,
  editorState,
  onOpenEditor,
  onChangeEditor,
  onSaveEditor,
  onCloseEditor,
  onDiscardEditor,
  onDeleteBookmark
}: SortableBookmarkCardProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const actionButtonRef = useRef<HTMLButtonElement | null>(null);
  const actionMenuRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const [isActionMenuOpen, setIsActionMenuOpen] = useState(false);
  const [actionMenuPosition, setActionMenuPosition] = useState<{ left: number; top: number } | null>(null);
  const [editorPosition, setEditorPosition] = useState<{ left: number; top: number } | null>(null);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: bookmark.id,
    disabled: !dragEnabled,
    data: {
      type: 'bookmark',
      categoryId
    }
  });
  const dragCardProps = dragEnabled ? { ...attributes, ...listeners } : {};

  useEffect(() => {
    if (!isEditorOpen && !isActionMenuOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (isActionMenuOpen) {
          setIsActionMenuOpen(false);
          return;
        }

        if (isEditorOpen) {
          void onCloseEditor();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isActionMenuOpen, isEditorOpen, onCloseEditor]);

  useEffect(() => {
    if (!isEditorOpen) {
      return;
    }

    const handleClick = (event: MouseEvent) => {
      const target = event.target;

      if (!(target instanceof Node)) {
        return;
      }

      if (editorRef.current?.contains(target)) {
        return;
      }

      void onCloseEditor();
    };

    document.addEventListener('click', handleClick);

    return () => {
      document.removeEventListener('click', handleClick);
    };
  }, [isEditorOpen, onCloseEditor]);

  useEffect(() => {
    if (!isEditorOpen) {
      setEditorPosition(null);
      return;
    }

    const updateEditorPosition = () => {
      const rect = cardRef.current?.getBoundingClientRect();

      if (!rect) {
        return;
      }

      const desiredWidth = 320;
      const viewportPadding = 16;
      const left = Math.min(
        window.innerWidth - desiredWidth - viewportPadding,
        Math.max(viewportPadding, rect.right - desiredWidth)
      );
      const top = Math.min(window.innerHeight - 240, rect.bottom + 8);

      setEditorPosition({ left, top });
    };

    updateEditorPosition();
    window.addEventListener('resize', updateEditorPosition);
    window.addEventListener('scroll', updateEditorPosition, true);

    return () => {
      window.removeEventListener('resize', updateEditorPosition);
      window.removeEventListener('scroll', updateEditorPosition, true);
    };
  }, [isEditorOpen]);

  useEffect(() => {
    if (!isActionMenuOpen) {
      return;
    }

    const handleClick = (event: MouseEvent) => {
      const target = event.target;

      if (!(target instanceof Node)) {
        return;
      }

      if (actionMenuRef.current?.contains(target) || actionButtonRef.current?.contains(target)) {
        return;
      }

      setIsActionMenuOpen(false);
    };

    document.addEventListener('click', handleClick);

    return () => {
      document.removeEventListener('click', handleClick);
    };
  }, [isActionMenuOpen]);

  const toggleActionMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();

    const rect = event.currentTarget.getBoundingClientRect();
    const menuWidth = 148;
    const viewportPadding = 12;
    const left = Math.min(
      window.innerWidth - menuWidth - viewportPadding,
      Math.max(viewportPadding, rect.right - menuWidth)
    );
    const top = Math.min(window.innerHeight - 120, rect.bottom + 8);

    setActionMenuPosition({
      left,
      top
    });
    setIsActionMenuOpen((current) => !current);
  };

  return (
    <div
      ref={(node) => {
        setNodeRef(node);
        cardRef.current = node;
      }}
      className={`item-card bookmark-card${dragEnabled ? ' drag-enabled' : ''}${isDragging ? ' dragging' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...dragCardProps}
    >
      <button
        type="button"
        className="bookmark-card-main"
        onClick={() => onOpen(bookmark.url)}
        title={bookmark.url}
      >
        <span className="bookmark-card-content">
          <FaviconImage url={bookmark.url} />
          <span className="bookmark-text">
            <span className="bookmark-card-badges">
              <span className="bookmark-title">{displayTitle}</span>
              {isAiSuggested ? <span className="bookmark-ai-badge">AI Added</span> : null}
              {isAutoClassifyFailed ? <span className="bookmark-failed-badge">Needs Review</span> : null}
            </span>
            <span className="bookmark-description">{description || '\u00A0'}</span>
          </span>
        </span>
      </button>
      <span className="bookmark-card-actions">
        <button
          ref={actionButtonRef}
          type="button"
          className={`bookmark-icon-button hover-action-button${isActionMenuOpen ? ' active' : ''}`}
          aria-label="Open bookmark actions"
          title="More actions"
          onClick={toggleActionMenu}
        >
          <MoreHorizontal size={14} strokeWidth={1.8} />
        </button>
      </span>
      {isActionMenuOpen && actionMenuPosition
        ? createPortal(
            <div
              ref={actionMenuRef}
              className="action-menu"
              style={{ left: actionMenuPosition.left, top: actionMenuPosition.top }}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                className="action-menu-item"
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setIsActionMenuOpen(false);
                  window.setTimeout(() => {
                    onOpenEditor(bookmark);
                  }, 0);
                }}
              >
                Rename
              </button>
              <button
                type="button"
                className="action-menu-item action-menu-item-danger"
                onClick={() => {
                  setIsActionMenuOpen(false);
                  onDeleteBookmark(bookmark);
                }}
              >
                Delete Bookmark
              </button>
            </div>,
            document.body
          )
        : null}
      {isEditorOpen && editorPosition
        ? createPortal(
            <div
              ref={editorRef}
              className="bookmark-editor-popover"
              style={{ left: editorPosition.left, top: editorPosition.top }}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="bookmark-editor-grid">
                <label className="bookmark-editor-field">
                  <span>Name</span>
                  <input
                    className="bookmark-card-input"
                    type="text"
                    value={editorState.title}
                    autoFocus
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        onSaveEditor(bookmark);
                      }
                    }}
                    onChange={(event) => onChangeEditor('title', event.target.value)}
                  />
                </label>
                <label className="bookmark-editor-field">
                  <span>URL</span>
                  <input
                    className="bookmark-card-input"
                    type="text"
                    value={editorState.url}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        onSaveEditor(bookmark);
                      }
                    }}
                    onChange={(event) => onChangeEditor('url', event.target.value)}
                  />
                </label>
                <label className="bookmark-editor-field bookmark-editor-field-wide">
                  <span>Description</span>
                  <textarea
                    className="bookmark-card-textarea"
                    value={editorState.description}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                        event.preventDefault();
                        onSaveEditor(bookmark);
                      }
                    }}
                    onChange={(event) => onChangeEditor('description', event.target.value)}
                  />
                </label>
              </div>
              <div className="bookmark-editor-actions">
                <button type="button" className="bookmark-secondary-button" onClick={onDiscardEditor}>
                  Ignore Changes
                </button>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

function SortableCategorySection({
  category,
  isExpanded,
  dragEnabled,
  isDraftMode,
  isEditing,
  editingTitle,
  isAiGeneratedCategory,
  aiSuggestedBookmarkIds,
  autoClassifyFailedIds,
  showAiReviewActions,
  onToggle,
  onOpenBookmark,
  onStartEdit,
  onChangeEditingTitle,
  onCommitEdit,
  onDeleteCategory,
  onAcceptAiCategory,
  onRejectAiCategory,
  getDisplayTitle,
  getBookmarkDescription,
  editorBookmarkId,
  editorState,
  onOpenBookmarkEditor,
  onChangeBookmarkEditor,
  onSaveBookmarkEditor,
  onCloseBookmarkEditor,
  onDiscardBookmarkEditor,
  onDeleteBookmark
}: SortableCategorySectionProps) {
  const { setNodeRef: setDropZoneRef, isOver: isDropZoneOver } = useDroppable({
    id: `dropzone-${category.id}`,
    disabled: !dragEnabled,
    data: {
      type: 'bookmark-dropzone',
      categoryId: category.id
    }
  });
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: category.id,
    disabled: !dragEnabled || category.isSystem,
    data: {
      type: 'category',
      categoryId: category.id
    }
  });

  return (
    <section
      ref={setNodeRef}
      className={`bookmark-section${isDragging ? ' dragging' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <div className={`bookmark-section-header${dragEnabled && !category.isSystem ? ' drag-enabled' : ''}`}>
        <span className="bookmark-section-title">
          <span className="bookmark-section-title-row">
            <button
              type="button"
              className="bookmark-section-toggle"
              onClick={() => onToggle(category.id)}
              {...attributes}
              {...listeners}
            >
              {isEditing ? (
                <input
                  className="bookmark-category-input"
                  type="text"
                  value={editingTitle}
                  autoFocus
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => onChangeEditingTitle(event.target.value)}
                  onBlur={onCommitEdit}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      onCommitEdit();
                    }
                  }}
                />
              ) : (
                <span className="bookmark-section-name">{category.title}</span>
              )}
            </button>
            {isAiGeneratedCategory ? <span className="bookmark-ai-badge">AI Category</span> : null}
            <span className="bookmark-section-meta">{category.bookmarks.length} items</span>
          </span>
          {isDraftMode && category.isVirtual ? (
            <span className="bookmark-section-actions">
              {showAiReviewActions ? (
                <>
                  <button
                    type="button"
                    className="bookmark-icon-button bookmark-review-button"
                    onClick={() => onAcceptAiCategory(category.id)}
                  >
                    Accept AI Changes
                  </button>
                  <button
                    type="button"
                    className="bookmark-icon-button bookmark-review-button"
                    onClick={() => onRejectAiCategory(category.id)}
                  >
                    Revert AI Changes
                  </button>
                </>
              ) : null}
              <button
                type="button"
                className="bookmark-icon-button"
                aria-label="Rename category"
                title="Rename"
                onClick={() => onStartEdit(category)}
              >
                <PencilLine size={14} strokeWidth={1.8} />
              </button>
              <button
                type="button"
                className="bookmark-icon-button"
                aria-label="Delete category"
                title="Delete"
                onClick={() => onDeleteCategory(category.id)}
              >
                <Trash2 size={14} strokeWidth={1.8} />
              </button>
            </span>
          ) : null}
        </span>
        <button
          type="button"
          className="bookmark-section-toggle bookmark-section-toggle-icon"
          onClick={() => onToggle(category.id)}
        >
          <span className={`bookmark-section-chevron${isExpanded ? ' expanded' : ''}`} aria-hidden="true">
            ›
          </span>
        </button>
      </div>

      {isExpanded ? (
        <SortableContext items={category.bookmarks.map((bookmark) => bookmark.id)} strategy={rectSortingStrategy}>
          <div
            ref={setDropZoneRef}
            className={`bookmark-grid${isDropZoneOver ? ' dropzone-active' : ''}${category.bookmarks.length === 0 ? ' empty' : ''}`}
          >
            {category.bookmarks.map((bookmark) => {
              return (
                <SortableBookmarkCard
                  key={bookmark.id}
                  bookmark={bookmark}
                  categoryId={category.id}
                  dragEnabled={dragEnabled}
                  onOpen={onOpenBookmark}
                  isAiSuggested={aiSuggestedBookmarkIds.has(bookmark.id)}
                  isAutoClassifyFailed={category.isSystem === true && autoClassifyFailedIds.has(bookmark.id)}
                  displayTitle={getDisplayTitle(bookmark)}
                  description={getBookmarkDescription(bookmark.id)}
                  isEditorOpen={editorBookmarkId === bookmark.id}
                  editorState={editorState}
                  onOpenEditor={onOpenBookmarkEditor}
                  onChangeEditor={onChangeBookmarkEditor}
                  onSaveEditor={onSaveBookmarkEditor}
                  onCloseEditor={onCloseBookmarkEditor}
                  onDiscardEditor={onDiscardBookmarkEditor}
                  onDeleteBookmark={onDeleteBookmark}
                />
              );
            })}
            {category.bookmarks.length === 0 ? (
              <div className="bookmark-empty-dropzone">Drop bookmarks here</div>
            ) : null}
          </div>
        </SortableContext>
      ) : null}
    </section>
  );
}

export default function RightPanel({
  deepseekApiKey,
  fullAiClassificationTrigger,
  organizeCommand,
  onOrganizeStateChange
}: RightPanelProps) {
  const [allBookmarks, setAllBookmarks] = useState<BookmarkItem[]>([]);
  const [storedVirtualCategories, setStoredVirtualCategories] = useState<VirtualBookmarkCategory[]>([]);
  const [draftVirtualCategories, setDraftVirtualCategories] = useState<VirtualBookmarkCategory[] | null>(null);
  const [expandedCategoryIds, setExpandedCategoryIds] = useState<Record<string, boolean>>({});
  const [filterQuery, setFilterQuery] = useState('');
  const [activeDragType, setActiveDragType] = useState<'category' | 'bookmark' | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [autoNoticeMessage, setAutoNoticeMessage] = useState<string | null>(null);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAiProcessing, setIsAiProcessing] = useState(false);
  const [aiGeneratedCategoryIds, setAiGeneratedCategoryIds] = useState<string[]>([]);
  const [aiSuggestedBookmarkIds, setAiSuggestedBookmarkIds] = useState<string[]>([]);
  const [autoClassifyFailedIds, setAutoClassifyFailedIds] = useState<string[]>([]);
  const [urlNameCache, setUrlNameCache] = useState<Record<string, string>>({});
  const [bookmarkMetadata, setBookmarkMetadata] = useState<BookmarkMetadataMap>({});
  const [editorBookmarkId, setEditorBookmarkId] = useState<string | null>(null);
  const [editorState, setEditorState] = useState({ title: '', url: '', description: '' });
  const lastProcessedOrganizeCommandNonce = useRef(0);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const reloadBookmarks = async () => {
    const bookmarks = await getAllBookmarks();
    setAllBookmarks(bookmarks);
  };

  const persistCurrentState = async (
    nextExpanded: Record<string, boolean>,
    nextVirtualCategories: VirtualBookmarkCategory[]
  ) => {
    await saveBookmarkPanelState({
      expandedCategoryIds: nextExpanded,
      virtualCategories: nextVirtualCategories
    });
  };

  useEffect(() => {
    let isMounted = true;

    async function loadPanel() {
      try {
        const [bookmarks, panelState, autoNotice, storedUrlNameCache, storedBookmarkMetadata, failedIds] = await Promise.all([
          getAllBookmarks(),
          getBookmarkPanelState(),
          getAutoClassifyNotice(),
          getUrlNameCache(),
          getBookmarkMetadata(),
          getAutoClassifyFailedIds()
        ]);

        if (!isMounted) {
          return;
        }

        setAllBookmarks(bookmarks);
        setStoredVirtualCategories(panelState.virtualCategories);
        setUrlNameCache(storedUrlNameCache);
        setBookmarkMetadata(storedBookmarkMetadata);
        setAutoClassifyFailedIds(failedIds);

        const initialCategories = buildViewCategories(bookmarks, panelState.virtualCategories);
        setExpandedCategoryIds(
          initialCategories.reduce<Record<string, boolean>>((accumulator, category) => {
            accumulator[category.id] = panelState.expandedCategoryIds[category.id] ?? true;
            return accumulator;
          }, {})
        );

        if (autoNotice) {
          setAutoNoticeMessage(autoNotice);
          await saveAutoClassifyNotice('');
        }
      } catch (loadError) {
        if (!isMounted) {
          return;
        }

        setError(loadError instanceof Error ? loadError.message : 'Failed to load bookmarks.');
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadPanel();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (typeof chrome === 'undefined' || typeof chrome.bookmarks?.onCreated === 'undefined') {
      return;
    }

    const handleBookmarksChanged = () => {
      void reloadBookmarks();
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
    if (typeof chrome === 'undefined' || typeof chrome.storage?.onChanged === 'undefined') {
      return;
    }

    const handleStorageChange = async (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string
    ) => {
      if (areaName !== 'local') {
        return;
      }

      if (changes.bookmarkPanelState?.newValue) {
        const nextPanelState = changes.bookmarkPanelState.newValue as {
          expandedCategoryIds?: Record<string, boolean>;
          virtualCategories?: VirtualBookmarkCategory[];
        };

        if (Array.isArray(nextPanelState.virtualCategories)) {
          setStoredVirtualCategories(nextPanelState.virtualCategories);
        }

        if (nextPanelState.expandedCategoryIds) {
          setExpandedCategoryIds((current) => ({
            ...current,
            ...nextPanelState.expandedCategoryIds
          }));
        }
      }

      if (changes.urlNameCache?.newValue && typeof changes.urlNameCache.newValue === 'object') {
        setUrlNameCache(changes.urlNameCache.newValue as Record<string, string>);
      }

      if (changes.bookmarkMetadata?.newValue && typeof changes.bookmarkMetadata.newValue === 'object') {
        setBookmarkMetadata(changes.bookmarkMetadata.newValue as BookmarkMetadataMap);
      }

      if (changes.autoClassifyFailedIds?.newValue && Array.isArray(changes.autoClassifyFailedIds.newValue)) {
        setAutoClassifyFailedIds(changes.autoClassifyFailedIds.newValue as string[]);
      }

      if (typeof changes.autoClassifyNotice?.newValue === 'string' && changes.autoClassifyNotice.newValue) {
        setAutoNoticeMessage(changes.autoClassifyNotice.newValue);
        await saveAutoClassifyNotice('');
      }
    };

    chrome.storage.onChanged.addListener(handleStorageChange);

    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, []);

  useEffect(() => {
    if (!autoNoticeMessage) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setAutoNoticeMessage(null);
    }, 3000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [autoNoticeMessage]);

  useEffect(() => {
    if (!statusMessage) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setStatusMessage(null);
    }, 3000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [statusMessage]);

  useEffect(() => {
    if (!fullAiClassificationTrigger.nonce || !deepseekApiKey.trim() || allBookmarks.length === 0) {
      return;
    }

    let isCancelled = false;

    async function runFullClassification() {
      setIsAiProcessing(true);

      try {
        if (fullAiClassificationTrigger.mode === 'overwrite') {
          const result = await classifyBookmarksWithDeepSeek(deepseekApiKey, allBookmarks);

          if (isCancelled) {
            return;
          }

          const nextDraftCategories = buildDraftCategoriesFromClassification(result, allBookmarks);

          setDraftVirtualCategories(nextDraftCategories);
          setEditingCategoryId(null);
          setEditingTitle('');
          setAiGeneratedCategoryIds(nextDraftCategories.map((category) => category.id));
          setAiSuggestedBookmarkIds(nextDraftCategories.flatMap((category) => category.bookmarkIds));
          setStatusMessage('DeepSeek created a draft using overwrite mode. Review it in the sandbox preview on the right.');
          return;
        }

        const currentCategories = cloneVirtualCategories(storedVirtualCategories);
        const assignedBookmarkIds = new Set(currentCategories.flatMap((category) => category.bookmarkIds));
        const unclassifiedBookmarks = allBookmarks.filter((bookmark) => !assignedBookmarkIds.has(bookmark.id));

        if (unclassifiedBookmarks.length === 0) {
          setStatusMessage('There are no unclassified bookmarks to fill right now.');
          return;
        }

        const result = await classifyBookmarksWithDeepSeek(deepseekApiKey, unclassifiedBookmarks);

        if (isCancelled) {
          return;
        }

        const aiDraftCategories = buildDraftCategoriesFromClassification(result, unclassifiedBookmarks);
        const nextDraftCategories = cloneVirtualCategories(currentCategories);

        for (const aiCategory of aiDraftCategories) {
          const existingCategory = nextDraftCategories.find((category) => category.title === aiCategory.title);

          if (existingCategory) {
            for (const bookmarkId of aiCategory.bookmarkIds) {
              if (!existingCategory.bookmarkIds.includes(bookmarkId)) {
                existingCategory.bookmarkIds.push(bookmarkId);
              }
            }
            continue;
          }

          nextDraftCategories.push(aiCategory);
        }

        setDraftVirtualCategories(nextDraftCategories);
        setEditingCategoryId(null);
        setEditingTitle('');
        setAiGeneratedCategoryIds(
          aiDraftCategories
            .filter(
              (aiCategory) => !currentCategories.some((category) => category.title === aiCategory.title)
            )
            .map((category) => category.id)
        );
        setAiSuggestedBookmarkIds(aiDraftCategories.flatMap((category) => category.bookmarkIds));
        setStatusMessage('DeepSeek created a draft using unclassified-only mode. Review it in the sandbox preview on the right.');
      } catch (classificationError) {
        if (!isCancelled) {
          setStatusMessage(
            classificationError instanceof Error ? classificationError.message : 'Full AI classification failed.'
          );
        }
      } finally {
        if (!isCancelled) {
          setIsAiProcessing(false);
        }
      }
    }

    void runFullClassification();

    return () => {
      isCancelled = true;
    };
  }, [allBookmarks, deepseekApiKey, fullAiClassificationTrigger, storedVirtualCategories]);

  const activeVirtualCategories = draftVirtualCategories ?? storedVirtualCategories;
  const sourceCategories = buildViewCategories(allBookmarks, activeVirtualCategories);
  const normalizedQuery = filterQuery.trim().toLowerCase();
  const isDraftMode = draftVirtualCategories !== null;
  const dragEnabled = isDraftMode && normalizedQuery.length === 0;

  const filteredCategories = sourceCategories
    .map((category) => ({
      ...category,
      bookmarks: category.bookmarks.filter((bookmark) => {
        if (!normalizedQuery) {
          return true;
        }

        const displayTitle = urlNameCache[bookmark.url] || bookmark.title;
        const description = bookmarkMetadata[bookmark.id]?.description ?? '';
        const target = `${displayTitle} ${bookmark.title} ${bookmark.url} ${bookmark.sourcePath} ${description}`.toLowerCase();
        return target.includes(normalizedQuery);
      })
    }))
    .filter((category) => {
      if (!normalizedQuery) {
        return true;
      }

      return category.bookmarks.length > 0 || category.title.toLowerCase().includes(normalizedQuery);
    });

  const footerStatus = useMemo(() => {
    if (isAiProcessing) {
      return 'AI is processing...';
    }

    if (autoNoticeMessage) {
      return autoNoticeMessage;
    }

    if (statusMessage) {
      return statusMessage;
    }

    return null;
  }, [autoNoticeMessage, isAiProcessing, statusMessage]);

  useEffect(() => {
    onOrganizeStateChange({
      isDraftMode,
      statusMessage: footerStatus
    });
  }, [footerStatus, isDraftMode, onOrganizeStateChange]);

  useEffect(() => {
    if (!organizeCommand.nonce) {
      return;
    }

    if (organizeCommand.nonce === lastProcessedOrganizeCommandNonce.current) {
      return;
    }

    lastProcessedOrganizeCommandNonce.current = organizeCommand.nonce;

    if (organizeCommand.action === 'open') {
      if (!isDraftMode) {
        setDraftVirtualCategories(cloneVirtualCategories(storedVirtualCategories));
        setStatusMessage(null);
        setAiGeneratedCategoryIds([]);
        setAiSuggestedBookmarkIds([]);
      }
      return;
    }

    if (organizeCommand.action === 'create') {
      if (!isDraftMode) {
        setDraftVirtualCategories(cloneVirtualCategories(storedVirtualCategories));
        setStatusMessage(null);
        setAiGeneratedCategoryIds([]);
        setAiSuggestedBookmarkIds([]);
        return;
      }

      const categoryId = `virtual-${Date.now()}`;
      const nextCategory: VirtualBookmarkCategory = {
        id: categoryId,
        title: 'New Category',
        bookmarkIds: []
      };

      setDraftVirtualCategories((current) => {
        if (!current) {
          return [nextCategory];
        }

        return [...cloneVirtualCategories(current), nextCategory];
      });
      setExpandedCategoryIds((current) => ({
        ...current,
        [categoryId]: true
      }));
      setEditingCategoryId(categoryId);
      setEditingTitle('New Category');
      return;
    }

    if (organizeCommand.action === 'save') {
      if (!draftVirtualCategories) {
        return;
      }

      const nextDraftCategories = cloneVirtualCategories(draftVirtualCategories);
      setStoredVirtualCategories(nextDraftCategories);
      setDraftVirtualCategories(null);
      setActiveDragType(null);
      setEditingCategoryId(null);
      setEditingTitle('');
      setAiGeneratedCategoryIds([]);
      setAiSuggestedBookmarkIds([]);
      void persistCurrentState(expandedCategoryIds, nextDraftCategories);
      setStatusMessage('Web categories saved. The original Chrome bookmark tree was not modified.');
      return;
    }

    if (organizeCommand.action === 'discard' && isDraftMode) {
      setDraftVirtualCategories(null);
      setActiveDragType(null);
      setEditingCategoryId(null);
      setEditingTitle('');
      setAiGeneratedCategoryIds([]);
      setAiSuggestedBookmarkIds([]);
      setStatusMessage('Draft changes discarded. Web categories have been restored to the last saved state.');
    }
  }, [organizeCommand, isDraftMode, storedVirtualCategories, draftVirtualCategories, expandedCategoryIds]);

  if (isLoading) {
    return <div style={{ color: '#667085', fontSize: '13px' }}>Loading...</div>;
  }

  if (error) {
    return <div style={{ color: '#b42318', fontSize: '13px' }}>{error}</div>;
  }

  if (allBookmarks.length === 0) {
    return <div style={{ color: '#667085', fontSize: '13px' }}>No bookmarks.</div>;
  }

  const toggleCategory = (categoryId: string) => {
    setExpandedCategoryIds((current) => {
      const nextState = {
        ...current,
        [categoryId]: !current[categoryId]
      };

      void persistCurrentState(nextState, storedVirtualCategories);
      return nextState;
    });
  };

  const openBookmark = (url: string) => {
    window.location.href = url;
  };

  const getDisplayTitle = (bookmark: BookmarkItem) => urlNameCache[bookmark.url] || bookmark.title;
  const getBookmarkDescription = (bookmarkId: string) => bookmarkMetadata[bookmarkId]?.description ?? '';

  const acceptAiCategory = (categoryId: string) => {
    if (!draftVirtualCategories) {
      return;
    }

    const draftCategory = draftVirtualCategories.find((category) => category.id === categoryId);

    if (!draftCategory) {
      return;
    }

    const acceptedBookmarkIds = draftCategory.bookmarkIds.filter((bookmarkId) =>
      aiSuggestedBookmarkIds.includes(bookmarkId)
    );

    const nextStoredCategories = cloneVirtualCategories(storedVirtualCategories);
    const storedCategoryIndex = nextStoredCategories.findIndex((category) => category.id === categoryId);

    if (storedCategoryIndex >= 0) {
      nextStoredCategories[storedCategoryIndex] = {
        ...draftCategory,
        bookmarkIds: [...draftCategory.bookmarkIds]
      };
    } else {
      nextStoredCategories.push({
        ...draftCategory,
        bookmarkIds: [...draftCategory.bookmarkIds]
      });
    }

    setStoredVirtualCategories(nextStoredCategories);
    void persistCurrentState(expandedCategoryIds, nextStoredCategories);

    setAiGeneratedCategoryIds((current) => current.filter((id) => id !== categoryId));
    setAiSuggestedBookmarkIds((current) => current.filter((id) => !acceptedBookmarkIds.includes(id)));
    setStatusMessage(`Accepted the AI draft for "${draftCategory.title}".`);
  };

  const rejectAiCategory = (categoryId: string) => {
    if (!draftVirtualCategories) {
      return;
    }

    const storedCategory = storedVirtualCategories.find((category) => category.id === categoryId);
    const draftCategory = draftVirtualCategories.find((category) => category.id === categoryId);

    if (!draftCategory) {
      return;
    }

    const rejectedBookmarkIds = draftCategory.bookmarkIds.filter((bookmarkId) =>
      aiSuggestedBookmarkIds.includes(bookmarkId)
    );

    setDraftVirtualCategories((current) => {
      if (!current) {
        return current;
      }

      if (!storedCategory) {
        return current.filter((category) => category.id !== categoryId);
      }

      return current.map((category) =>
        category.id === categoryId
          ? {
              ...storedCategory,
              bookmarkIds: [...storedCategory.bookmarkIds]
            }
          : category
      );
    });

    setAiGeneratedCategoryIds((current) => current.filter((id) => id !== categoryId));
    setAiSuggestedBookmarkIds((current) => current.filter((id) => !rejectedBookmarkIds.includes(id)));
    setStatusMessage(`Reverted the AI draft for "${draftCategory.title}".`);
  };

  const updateDraftVirtualCategories = (
    updater: (current: VirtualBookmarkCategory[]) => VirtualBookmarkCategory[]
  ) => {
    setDraftVirtualCategories((current) => {
      if (!current) {
        return current;
      }

      return updater(cloneVirtualCategories(current));
    });
  };

  const openBookmarkEditor = (bookmark: BookmarkItem) => {
    if (editorBookmarkId === bookmark.id) {
      void closeBookmarkEditor();
      return;
    }

    setEditorBookmarkId(bookmark.id);
    setEditorState({
      title: getDisplayTitle(bookmark),
      url: bookmark.url,
      description: getBookmarkDescription(bookmark.id)
    });
  };

  const resetBookmarkEditor = () => {
    setEditorBookmarkId(null);
    setEditorState({ title: '', url: '', description: '' });
  };

  const discardBookmarkEditor = () => {
    resetBookmarkEditor();
  };

  const changeBookmarkEditor = (field: 'title' | 'url' | 'description', value: string) => {
    setEditorState((current) => ({
      ...current,
      [field]: value
    }));
  };

  const saveBookmarkEditor = async (bookmark: BookmarkItem) => {
    const nextTitle = editorState.title.trim() || bookmark.title || bookmark.url;
    const nextUrl = editorState.url.trim() || bookmark.url;
    const nextDescription = editorState.description.trim();
    const nextUrlNameCache = {
      ...urlNameCache,
      [nextUrl]: nextTitle
    };

    if (bookmark.url !== nextUrl) {
      delete nextUrlNameCache[bookmark.url];
    }

    const nextBookmarkMetadata = {
      ...bookmarkMetadata
    };

    if (nextDescription) {
      nextBookmarkMetadata[bookmark.id] = {
        description: nextDescription
      };
    } else {
      delete nextBookmarkMetadata[bookmark.id];
    }

    setUrlNameCache(nextUrlNameCache);
    setBookmarkMetadata(nextBookmarkMetadata);
    setAllBookmarks((current) =>
      current.map((item) =>
        item.id === bookmark.id
          ? {
              ...item,
              title: nextTitle,
              url: nextUrl
            }
          : item
      )
    );
    resetBookmarkEditor();

    const persistPromises = [saveUrlNameCache(nextUrlNameCache), saveBookmarkMetadata(nextBookmarkMetadata)];

    if (typeof chrome !== 'undefined' && typeof chrome.bookmarks?.update === 'function') {
      await new Promise<void>((resolve) => {
        chrome.bookmarks.update(bookmark.id, { title: nextTitle }, () => resolve());
      });

      if (nextUrl !== bookmark.url) {
        try {
          await new Promise<void>((resolve) => {
            chrome.bookmarks.update(bookmark.id, { url: nextUrl }, () => resolve());
          });
        } catch {
          setStatusMessage(`Updated "${nextTitle}", but the URL could not be changed.`);
        }
      }
    }

    await Promise.all(persistPromises);
    setStatusMessage((current) => current ?? `Updated "${nextTitle}".`);
  };

  const closeBookmarkEditor = () => {
    if (!editorBookmarkId) {
      resetBookmarkEditor();
      return;
    }

    const targetBookmark = allBookmarks.find((bookmark) => bookmark.id === editorBookmarkId);

    if (!targetBookmark) {
      resetBookmarkEditor();
      return;
    }

    const currentTitle = getDisplayTitle(targetBookmark);
    const currentUrl = targetBookmark.url;
    const currentDescription = getBookmarkDescription(targetBookmark.id);
    const nextTitle = editorState.title.trim() || targetBookmark.title || targetBookmark.url;
    const nextUrl = editorState.url.trim() || targetBookmark.url;
    const nextDescription = editorState.description.trim();
    const hasChanges =
      nextTitle !== currentTitle || nextUrl !== currentUrl || nextDescription !== currentDescription;

    if (!hasChanges) {
      resetBookmarkEditor();
      return;
    }

    void saveBookmarkEditor(targetBookmark);
  };

  const deleteBookmarkItem = async (bookmark: BookmarkItem) => {
    const nextUrlNameCache = {
      ...urlNameCache
    };
    delete nextUrlNameCache[bookmark.url];

    const nextBookmarkMetadata = {
      ...bookmarkMetadata
    };
    delete nextBookmarkMetadata[bookmark.id];

    const nextStoredVirtualCategories = removeBookmarkFromCategories(cloneVirtualCategories(storedVirtualCategories), bookmark.id);
    const nextDraftVirtualCategories = draftVirtualCategories
      ? removeBookmarkFromCategories(cloneVirtualCategories(draftVirtualCategories), bookmark.id)
      : null;

    setUrlNameCache(nextUrlNameCache);
    setBookmarkMetadata(nextBookmarkMetadata);
    setStoredVirtualCategories(nextStoredVirtualCategories);
    setDraftVirtualCategories(nextDraftVirtualCategories);
    setAllBookmarks((current) => current.filter((item) => item.id !== bookmark.id));
    setAiSuggestedBookmarkIds((current) => current.filter((id) => id !== bookmark.id));
    resetBookmarkEditor();

    await Promise.all([
      saveUrlNameCache(nextUrlNameCache),
      saveBookmarkMetadata(nextBookmarkMetadata),
      persistCurrentState(expandedCategoryIds, nextStoredVirtualCategories),
      removeBookmark(bookmark.id)
    ]);

    setStatusMessage(`Deleted "${getDisplayTitle(bookmark)}".`);
  };

  const startEditingCategory = (category: BookmarkCategory) => {
    setEditingCategoryId(category.id);
    setEditingTitle(category.title);
  };

  const commitCategoryEdit = () => {
    if (!editingCategoryId || !draftVirtualCategories) {
      setEditingCategoryId(null);
      setEditingTitle('');
      return;
    }

    const nextTitle = editingTitle.trim() || 'Untitled Category';

    updateDraftVirtualCategories((current) =>
      current.map((category) =>
        category.id === editingCategoryId
          ? {
              ...category,
              title: nextTitle
            }
          : category
      )
    );

    setEditingCategoryId(null);
    setEditingTitle('');
  };

  const deleteCategory = (categoryId: string) => {
    updateDraftVirtualCategories((current) => current.filter((category) => category.id !== categoryId));

    setEditingCategoryId((current) => (current === categoryId ? null : current));
    setEditingTitle((current) => (editingCategoryId === categoryId ? '' : current));
  };

  const removeBookmarkFromCategories = (categories: VirtualBookmarkCategory[], bookmarkId: string) =>
    categories.map((category) => ({
      ...category,
      bookmarkIds: category.bookmarkIds.filter((id) => id !== bookmarkId)
    }));

  const insertBookmarkIntoCategory = (
    categories: VirtualBookmarkCategory[],
    categoryId: string,
    bookmarkId: string,
    insertIndex?: number
  ) =>
    categories.map((category) => {
      if (category.id !== categoryId) {
        return category;
      }

      const nextBookmarkIds = [...category.bookmarkIds];
      const safeIndex = insertIndex === undefined || insertIndex < 0 ? nextBookmarkIds.length : insertIndex;
      nextBookmarkIds.splice(safeIndex, 0, bookmarkId);

      return {
        ...category,
        bookmarkIds: nextBookmarkIds
      };
    });

  const handleDragStart = (event: DragStartEvent) => {
    const type = event.active.data.current?.type;

    if (type === 'category' || type === 'bookmark') {
      setActiveDragType(type);
    }
  };

  const handleDragOver = (event: DragOverEvent) => {
    if (!dragEnabled || activeDragType !== 'bookmark' || !event.over) {
      return;
    }

    const activeBookmarkId = String(event.active.id);
    const overType = event.over.data.current?.type;
    const overCategoryId =
      typeof event.over.data.current?.categoryId === 'string'
        ? event.over.data.current.categoryId
        : String(event.over.id);

    updateDraftVirtualCategories((current) => {
      const withoutActive = removeBookmarkFromCategories(current, activeBookmarkId);

      if (overCategoryId === UNCLASSIFIED_CATEGORY_ID) {
        return withoutActive;
      }

      const targetCategory = sourceCategories.find((category) => category.id === overCategoryId);
      const overIndex =
        overType === 'bookmark' && targetCategory
          ? targetCategory.bookmarks.findIndex((bookmark) => bookmark.id === String(event.over?.id))
          : undefined;

      return insertBookmarkIntoCategory(withoutActive, overCategoryId, activeBookmarkId, overIndex);
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDragType(null);

    if (!dragEnabled || !event.over) {
      return;
    }

    const activeType = event.active.data.current?.type;
    const overType = event.over.data.current?.type;

    if (activeType === 'category' && overType === 'category' && event.active.id !== event.over.id) {
      updateDraftVirtualCategories((current) => {
        const oldIndex = current.findIndex((category) => category.id === String(event.active.id));
        const newIndex = current.findIndex((category) => category.id === String(event.over?.id));

        if (oldIndex < 0 || newIndex < 0) {
          return current;
        }

        return arrayMove(current, oldIndex, newIndex);
      });
    }
  };

  return (
    <div className="right-panel-layout">
      {footerStatus ? <div className="bookmark-toast">{footerStatus}</div> : null}
      <div className="bookmark-toolbar">
        <input
          className="bookmark-filter-input"
          type="text"
          value={filterQuery}
          placeholder="Search bookmarks"
          onChange={(event) => setFilterQuery(event.target.value)}
        />
      </div>
      <div className="right-panel-scroll">
        {filteredCategories.length === 0 ? (
          <div style={{ color: '#667085', fontSize: '13px' }}>No matching bookmarks found.</div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={filteredCategories.filter((category) => !category.isSystem).map((category) => category.id)}
              strategy={verticalListSortingStrategy}
            >
              {filteredCategories.map((category) => (
                <SortableCategorySection
                  key={category.id}
                  category={category}
                  isExpanded={expandedCategoryIds[category.id] ?? true}
                  dragEnabled={dragEnabled}
                  isDraftMode={isDraftMode}
                  isEditing={editingCategoryId === category.id}
                  editingTitle={editingTitle}
                  isAiGeneratedCategory={aiGeneratedCategoryIds.includes(category.id)}
                  aiSuggestedBookmarkIds={new Set(aiSuggestedBookmarkIds)}
                  autoClassifyFailedIds={new Set(autoClassifyFailedIds)}
                  showAiReviewActions={
                    aiGeneratedCategoryIds.includes(category.id) ||
                    category.bookmarks.some((bookmark) => aiSuggestedBookmarkIds.includes(bookmark.id))
                  }
                  onToggle={toggleCategory}
                  onOpenBookmark={openBookmark}
                  onStartEdit={startEditingCategory}
                  onChangeEditingTitle={setEditingTitle}
                  onCommitEdit={commitCategoryEdit}
                  onDeleteCategory={deleteCategory}
                  onAcceptAiCategory={acceptAiCategory}
                  onRejectAiCategory={rejectAiCategory}
                  getDisplayTitle={getDisplayTitle}
                  getBookmarkDescription={getBookmarkDescription}
                  editorBookmarkId={editorBookmarkId}
                  editorState={editorState}
                  onOpenBookmarkEditor={openBookmarkEditor}
                  onChangeBookmarkEditor={changeBookmarkEditor}
                  onSaveBookmarkEditor={saveBookmarkEditor}
                  onCloseBookmarkEditor={closeBookmarkEditor}
                  onDiscardBookmarkEditor={discardBookmarkEditor}
                  onDeleteBookmark={deleteBookmarkItem}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>
      <div className="right-panel-footer">
        {isDraftMode ? (
          <div className="bookmark-sandbox">
            <div className="bookmark-sandbox-content">
              <div className="bookmark-sandbox-title">Draft</div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
