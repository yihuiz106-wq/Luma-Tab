import { mockBookmarkCategories } from './mockData';
import type { BookmarkItem } from '../types/app';

function isChromeBookmarksAvailable() {
  return typeof chrome !== 'undefined' && typeof chrome.bookmarks?.getTree === 'function';
}

function mapBookmarkItem(node: chrome.bookmarks.BookmarkTreeNode, sourcePath: string): BookmarkItem | null {
  if (!node.url) {
    return null;
  }

  return {
    id: node.id,
    title: node.title || node.url,
    url: node.url,
    sourcePath
  };
}

function collectBookmarks(nodes: chrome.bookmarks.BookmarkTreeNode[] = [], pathSegments: string[] = []): BookmarkItem[] {
  const bookmarks: BookmarkItem[] = [];

  for (const node of nodes) {
    if (node.url) {
      const sourcePath = pathSegments.length > 0 ? pathSegments.join(' / ') : 'Root';
      const bookmark = mapBookmarkItem(node, sourcePath);

      if (bookmark) {
        bookmarks.push(bookmark);
      }

      continue;
    }

    const title = node.title || 'Untitled Category';
    const nextPathSegments = [...pathSegments, title];
    if (node.children?.length) {
      bookmarks.push(...collectBookmarks(node.children, nextPathSegments));
    }
  }

  return bookmarks;
}

export async function getAllBookmarks(): Promise<BookmarkItem[]> {
  if (!isChromeBookmarksAvailable()) {
    return mockBookmarkCategories.flatMap((category) => category.bookmarks);
  }

  return new Promise((resolve) => {
    chrome.bookmarks.getTree((tree) => {
      const bookmarks = collectBookmarks(tree[0]?.children ?? []);
      resolve(bookmarks.length > 0 ? bookmarks : mockBookmarkCategories.flatMap((category) => category.bookmarks));
    });
  });
}

export async function removeBookmark(bookmarkId: string): Promise<void> {
  if (!isChromeBookmarksAvailable() || typeof chrome.bookmarks?.remove !== 'function') {
    return;
  }

  return new Promise((resolve) => {
    chrome.bookmarks.remove(bookmarkId, () => resolve());
  });
}
