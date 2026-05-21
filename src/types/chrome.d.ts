declare namespace chrome {
  namespace runtime {
    function getURL(path: string): string;
  }

  namespace bookmarks {
    interface BookmarkTreeNode {
      id: string;
      title: string;
      url?: string;
      children?: BookmarkTreeNode[];
    }

    const onCreated: {
      addListener(callback: (id: string, bookmark: BookmarkTreeNode) => void): void;
      removeListener(callback: (id: string, bookmark: BookmarkTreeNode) => void): void;
    };

    const onRemoved: {
      addListener(callback: (id: string, removeInfo: { parentId: string; index: number; node: BookmarkTreeNode }) => void): void;
      removeListener(
        callback: (id: string, removeInfo: { parentId: string; index: number; node: BookmarkTreeNode }) => void
      ): void;
    };

    const onChanged: {
      addListener(callback: (id: string, changeInfo: { title: string; url?: string }) => void): void;
      removeListener(callback: (id: string, changeInfo: { title: string; url?: string }) => void): void;
    };

    function getTree(
      callback: (results: BookmarkTreeNode[]) => void
    ): void;

    function update(
      id: string,
      changes: { title?: string; url?: string },
      callback?: (result: BookmarkTreeNode) => void
    ): void;

    function remove(id: string, callback?: () => void): void;
  }

  namespace tabs {
    interface Tab {
      id?: number;
      url?: string;
      title?: string;
      active?: boolean;
      windowId?: number;
    }

    const onActivated: {
      addListener(callback: (activeInfo: { tabId: number; windowId: number }) => void): void;
    };

    function get(tabId: number, callback: (tab: Tab) => void): void;
    function query(
      queryInfo: { active?: boolean; windowId?: number; currentWindow?: boolean },
      callback: (tabs: Tab[]) => void
    ): void;
  }

  namespace windows {
    const WINDOW_ID_NONE: number;

    const onFocusChanged: {
      addListener(callback: (windowId: number) => void): void;
    };
  }

  namespace storage {
    interface StorageChange {
      oldValue?: unknown;
      newValue?: unknown;
    }

    namespace local {
      function get(
        keys: string | string[] | Record<string, unknown> | null,
        callback: (items: Record<string, unknown>) => void
      ): void;

      function set(
        items: Record<string, unknown>,
        callback?: () => void
      ): void;
    }

    const onChanged: {
      addListener(
        callback: (changes: Record<string, StorageChange>, areaName: 'local' | 'sync' | 'managed' | string) => void
      ): void;
      removeListener(
        callback: (changes: Record<string, StorageChange>, areaName: 'local' | 'sync' | 'managed' | string) => void
      ): void;
    };
  }
}
