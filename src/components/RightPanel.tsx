import {
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  PointerSensor,
  type CollisionDetection,
  closestCenter,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  useSortable
} from '@dnd-kit/sortable';
import { CSS, type Transform } from '@dnd-kit/utilities';
import { GripVertical, MoreHorizontal, PencilLine, Trash2, X } from 'lucide-react';
import { type WheelEvent as ReactWheelEvent, useEffect, useMemo, useRef, useState } from 'react';
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
const BOOKMARK_EDITOR_POPOVER_WIDTH = 248;
const DRAG_ACTIVATION_DISTANCE = 14;
const SORTABLE_TRANSITION = {
  duration: 280,
  easing: 'cubic-bezier(0.22, 1, 0.36, 1)'
};

const stableCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);

  if (pointerCollisions.length > 0) {
    return pointerCollisions;
  }

  const intersectingCollisions = rectIntersection(args);

  return intersectingCollisions.length > 0 ? intersectingCollisions : closestCenter(args);
};

function toStableSortableTransform(transform: Transform | null) {
  return CSS.Translate.toString(transform);
}

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

interface SortableCategoryRowProps {
  category: BookmarkCategory;
  isEditing: boolean;
  editingTitle: string;
  isAiGeneratedCategory: boolean;
  showAiReviewActions: boolean;
  onStartEdit: (category: BookmarkCategory) => void;
  onChangeEditingTitle: (value: string) => void;
  onCommitEdit: () => void;
  onDeleteCategory: (categoryId: string) => void;
  onAcceptAiCategory: (categoryId: string) => void;
  onRejectAiCategory: (categoryId: string) => void;
  onJumpToCategory: (categoryId: string) => void;
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

function containOverlayScroll(event: ReactWheelEvent<HTMLElement>) {
  const element = event.currentTarget;

  const nudgeClass = event.deltaY < 0 ? 'popover-bump-down' : 'popover-bump-up';

  if (element.scrollHeight <= element.clientHeight) {
    element.classList.remove('popover-bump-up', 'popover-bump-down');
    void element.offsetWidth;
    element.classList.add(nudgeClass);
    window.setTimeout(() => {
      element.classList.remove('popover-bump-up', 'popover-bump-down');
    }, 180);
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
    element.classList.remove('popover-bump-up', 'popover-bump-down');
    void element.offsetWidth;
    element.classList.add(nudgeClass);
    window.setTimeout(() => {
      element.classList.remove('popover-bump-up', 'popover-bump-down');
    }, 180);
  }

  event.preventDefault();
  event.stopPropagation();
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
  const [editorPlacement, setEditorPlacement] = useState<'start' | 'end'>('end');
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: bookmark.id,
    disabled: !dragEnabled,
    transition: SORTABLE_TRANSITION,
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
      return;
    }

    const updateEditorPlacement = () => {
      const cardRect = cardRef.current?.getBoundingClientRect();
      const scrollRect = cardRef.current
        ?.closest('.right-panel-scroll')
        ?.getBoundingClientRect();

      if (!cardRect || !scrollRect) {
        setEditorPlacement('end');
        return;
      }

      const startOverflow = Math.max(0, cardRect.left + BOOKMARK_EDITOR_POPOVER_WIDTH - scrollRect.right);
      const endOverflow = Math.max(0, scrollRect.left - (cardRect.right - BOOKMARK_EDITOR_POPOVER_WIDTH));

      setEditorPlacement(startOverflow <= endOverflow ? 'start' : 'end');
    };

    updateEditorPlacement();
    window.addEventListener('resize', updateEditorPlacement);

    return () => {
      window.removeEventListener('resize', updateEditorPlacement);
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

    setIsActionMenuOpen((current) => !current);
  };

  return (
    <div
      ref={(node) => {
        setNodeRef(node);
        cardRef.current = node;
      }}
      className={`item-card bookmark-card${dragEnabled ? ' drag-enabled' : ''}${isDragging ? ' dragging' : ''}`}
      style={{ transform: toStableSortableTransform(transform), transition }}
    >
      {dragEnabled ? (
        <button
          ref={setActivatorNodeRef}
          type="button"
          className="bookmark-drag-handle"
          aria-label={`Drag bookmark ${displayTitle}`}
          title="Drag bookmark"
          onClick={(event) => event.preventDefault()}
          {...dragCardProps}
        >
          <GripVertical size={14} strokeWidth={1.8} />
        </button>
      ) : null}
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
      {isActionMenuOpen ? (
        <div
          ref={actionMenuRef}
          className="action-menu"
          onMouseDown={(event) => event.stopPropagation()}
          onWheelCapture={containOverlayScroll}
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
            Edit
          </button>
          <button
            type="button"
            className="action-menu-item action-menu-item-danger"
            onClick={() => {
              setIsActionMenuOpen(false);
              onDeleteBookmark(bookmark);
            }}
          >
            Delete
          </button>
        </div>
      ) : null}
      {isEditorOpen ? (
            <div
              ref={editorRef}
              className={`bookmark-editor-popover ${editorPlacement === 'start' ? 'align-start' : 'align-end'}`}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
              onWheelCapture={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
            >
              <div className="bookmark-editor-header">
                <div className="bookmark-editor-title">Edit</div>
                <button
                  type="button"
                  className="bookmark-editor-close"
                  aria-label="Close editor"
                  title="Close"
                  onClick={onCloseEditor}
                >
                  <X size={14} strokeWidth={1.9} />
                </button>
              </div>
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
                <button type="button" className="bookmark-primary-button" onClick={() => onSaveEditor(bookmark)}>
                  Save
                </button>
                <button type="button" className="bookmark-secondary-button" onClick={onDiscardEditor}>
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
    </div>
  );
}

function SortableCategoryRow({
  category,
  isEditing,
  editingTitle,
  isAiGeneratedCategory,
  showAiReviewActions,
  onStartEdit,
  onChangeEditingTitle,
  onCommitEdit,
  onDeleteCategory,
  onAcceptAiCategory,
  onRejectAiCategory,
  onJumpToCategory
}: SortableCategoryRowProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: category.id,
    disabled: category.isSystem,
    transition: SORTABLE_TRANSITION,
    data: {
      type: 'category',
      categoryId: category.id
    }
  });

  return (
    <div
      ref={setNodeRef}
      className={`bookmark-category-sort-row${isDragging ? ' dragging' : ''}`}
      style={{ transform: toStableSortableTransform(transform), transition }}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        className="bookmark-drag-handle category-drag-handle"
        aria-label={`Drag category ${category.title}`}
        title="Drag category"
        onClick={(event) => event.preventDefault()}
        {...attributes}
        {...listeners}
      >
        <GripVertical size={14} strokeWidth={1.8} />
      </button>
      <button
        type="button"
        className={`bookmark-category-sort-main${isEditing ? ' editing' : ''}`}
        onClick={() => {
          if (!isEditing) {
            onJumpToCategory(category.id);
          }
        }}
      >
        {isEditing ? (
          <input
            className="bookmark-category-input"
            type="text"
            value={editingTitle}
            autoFocus
            onClick={(event) => event.stopPropagation()}
            onFocus={(event) => event.currentTarget.select()}
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
        {!isEditing && isAiGeneratedCategory ? <span className="bookmark-ai-badge">AI Category</span> : null}
        {!isEditing ? <span className="bookmark-section-meta">{category.bookmarks.length} items</span> : null}
      </button>
      {!isEditing ? <span className="bookmark-section-actions">
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
      </span> : null}
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
  const showInlineEditor = isEditing && !isDraftMode;
  const { setNodeRef: setHeaderDropTargetRef, isOver: isHeaderDropTargetOver } = useDroppable({
    id: `category-target-${category.id}`,
    disabled: !dragEnabled,
    data: {
      type: 'category-target',
      categoryId: category.id
    }
  });
  const { setNodeRef: setDropZoneRef, isOver: isDropZoneOver } = useDroppable({
    id: `dropzone-${category.id}`,
    disabled: !dragEnabled,
    data: {
      type: 'bookmark-dropzone',
      categoryId: category.id
    }
  });

  return (
    <section
      id={`bookmark-category-${category.id}`}
      className={`bookmark-section${isExpanded ? '' : ' collapsed'}${isHeaderDropTargetOver ? ' drop-target-active' : ''}`}
    >
      <div
        ref={setHeaderDropTargetRef}
        className={`bookmark-section-header${isHeaderDropTargetOver ? ' drop-target-active' : ''}`}
      >
        <span className="bookmark-section-title">
          <span className="bookmark-section-title-row">
            <button
              type="button"
              className="bookmark-section-toggle"
              onClick={() => onToggle(category.id)}
            >
              {showInlineEditor ? (
                <input
                  className="bookmark-category-input"
                  type="text"
                  value={editingTitle}
                  autoFocus
                  onClick={(event) => event.stopPropagation()}
                  onFocus={(event) => event.currentTarget.select()}
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
            className={`bookmark-grid${isDropZoneOver || isHeaderDropTargetOver ? ' dropzone-active' : ''}${category.bookmarks.length === 0 ? ' empty' : ''}`}
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
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: DRAG_ACTIVATION_DISTANCE } })
  );

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

    const isNewBookmarkNotice = autoNoticeMessage.startsWith('New bookmark:');
    const dismissDelay = isNewBookmarkNotice ? 7000 : 3000;

    const timeoutId = window.setTimeout(() => {
      setAutoNoticeMessage(null);
    }, dismissDelay);

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
    const handleSettingsOpened = () => {
      resetBookmarkEditor();
    };

    window.addEventListener('luma:settings-opened', handleSettingsOpened);

    return () => {
      window.removeEventListener('luma:settings-opened', handleSettingsOpened);
    };
  }, []);

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
          setStatusMessage('AI draft ready.');
          return;
        }

        const currentCategories = cloneVirtualCategories(storedVirtualCategories);
        const assignedBookmarkIds = new Set(currentCategories.flatMap((category) => category.bookmarkIds));
        const unclassifiedBookmarks = allBookmarks.filter((bookmark) => !assignedBookmarkIds.has(bookmark.id));

        if (unclassifiedBookmarks.length === 0) {
          setStatusMessage('No ungrouped bookmarks.');
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
        setStatusMessage('AI grouped ungrouped bookmarks.');
      } catch (classificationError) {
        if (!isCancelled) {
          setStatusMessage(
            classificationError instanceof Error ? classificationError.message : 'AI classify failed.'
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
  const sortableCategories = sourceCategories.filter((category) => !category.isSystem);

  const footerStatus = useMemo(() => {
    if (isAiProcessing) {
      return 'AI running...';
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
      const categoryId = `virtual-${Date.now()}`;
      const nextCategory: VirtualBookmarkCategory = {
        id: categoryId,
        title: 'New Category',
        bookmarkIds: []
      };

      setDraftVirtualCategories((current) => {
        if (!current) {
          return [...cloneVirtualCategories(storedVirtualCategories), nextCategory];
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
      setEditingCategoryId(null);
      setEditingTitle('');
      setAiGeneratedCategoryIds([]);
      setAiSuggestedBookmarkIds([]);
      void persistCurrentState(expandedCategoryIds, nextDraftCategories);
      setStatusMessage('Groups saved.');
      return;
    }

    if (organizeCommand.action === 'discard' && isDraftMode) {
      setDraftVirtualCategories(null);
      setEditingCategoryId(null);
      setEditingTitle('');
      setAiGeneratedCategoryIds([]);
      setAiSuggestedBookmarkIds([]);
      setStatusMessage('Draft discarded.');
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

  const jumpToCategory = (categoryId: string) => {
    const categoryElement = document.getElementById(`bookmark-category-${categoryId}`);

    if (!categoryElement) {
      return;
    }

    categoryElement.scrollIntoView({
      block: 'start',
      behavior: 'smooth'
    });
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
    setStatusMessage(`Accepted: ${draftCategory.title}`);
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
    setStatusMessage(`Reverted: ${draftCategory.title}`);
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
          setStatusMessage(`Updated: ${nextTitle} (URL unchanged)`);
        }
      }
    }

    await Promise.all(persistPromises);
    setStatusMessage((current) => current ?? `Updated: ${nextTitle}`);
  };

  const closeBookmarkEditor = () => {
    resetBookmarkEditor();
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

    setStatusMessage(`Deleted: ${getDisplayTitle(bookmark)}`);
  };

  const startEditingCategory = (category: BookmarkCategory) => {
    resetBookmarkEditor();
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

  const findBookmarkLocation = (categories: VirtualBookmarkCategory[], bookmarkId: string) => {
    for (const category of categories) {
      const index = category.bookmarkIds.indexOf(bookmarkId);

      if (index >= 0) {
        return { categoryId: category.id, index };
      }
    }

    return null;
  };

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

  const handleDragStart = () => {
    resetBookmarkEditor();
  };

  const handleDragOver = (event: DragOverEvent) => {
    if (!dragEnabled || event.active.data.current?.type !== 'bookmark' || !event.over) {
      return;
    }

    const activeBookmarkId = String(event.active.id);
    const overId = String(event.over.id);

    if (activeBookmarkId === overId) {
      return;
    }

    const overType = event.over.data.current?.type;
    const overCategoryId =
      typeof event.over.data.current?.categoryId === 'string'
        ? event.over.data.current.categoryId
        : overId;

    updateDraftVirtualCategories((current) => {
      const activeLocation = findBookmarkLocation(current, activeBookmarkId);

      if (overCategoryId === UNCLASSIFIED_CATEGORY_ID) {
        return activeLocation ? removeBookmarkFromCategories(current, activeBookmarkId) : current;
      }

      const targetCategory = current.find((category) => category.id === overCategoryId);

      if (!targetCategory) {
        return current;
      }

      const overIndex =
        overType === 'bookmark'
          ? targetCategory.bookmarkIds.findIndex((bookmarkId) => bookmarkId === overId)
          : -1;
      const insertIndex = overIndex >= 0 ? overIndex : targetCategory.bookmarkIds.length;

      if (activeLocation?.categoryId === overCategoryId && insertIndex === activeLocation.index) {
        return current;
      }

      const withoutActive = removeBookmarkFromCategories(current, activeBookmarkId);
      return insertBookmarkIntoCategory(withoutActive, overCategoryId, activeBookmarkId, insertIndex);
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
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
            collisionDetection={stableCollisionDetection}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
          >
            {dragEnabled && sortableCategories.length > 0 ? (
              <div className="bookmark-category-sorter">
                <div className="bookmark-category-sorter-header">
                  <span>Groups</span>
                  <span>{sortableCategories.length} groups</span>
                </div>
                <SortableContext
                  items={sortableCategories.map((category) => category.id)}
                  strategy={rectSortingStrategy}
                >
                  <div className="bookmark-category-sort-list">
                    {sortableCategories.map((category) => (
                      <SortableCategoryRow
                        key={category.id}
                        category={category}
                        isEditing={editingCategoryId === category.id}
                        editingTitle={editingTitle}
                        isAiGeneratedCategory={aiGeneratedCategoryIds.includes(category.id)}
                        showAiReviewActions={
                          aiGeneratedCategoryIds.includes(category.id) ||
                          category.bookmarks.some((bookmark) => aiSuggestedBookmarkIds.includes(bookmark.id))
                        }
                        onStartEdit={startEditingCategory}
                        onChangeEditingTitle={setEditingTitle}
                        onCommitEdit={commitCategoryEdit}
                        onDeleteCategory={deleteCategory}
                        onAcceptAiCategory={acceptAiCategory}
                        onRejectAiCategory={rejectAiCategory}
                        onJumpToCategory={jumpToCategory}
                      />
                    ))}
                  </div>
                </SortableContext>
              </div>
            ) : null}
            <div className="bookmark-section-list">
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
            </div>
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
