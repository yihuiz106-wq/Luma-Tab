const DB_NAME = 'ai-tab-extension-db';
const STORE_NAME = 'assets';
const KEY_PREFIX = 'favicon:';
const memoryFaviconCache = new Map<string, string>();

function isIndexedDbAvailable() {
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error ?? new Error('Failed to initialize IndexedDB.'));
    };
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const database = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    const request = callback(store);

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error ?? new Error('IndexedDB read/write failed.'));
    };

    transaction.oncomplete = () => {
      database.close();
    };

    transaction.onerror = () => {
      reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
    };
  });
}

function buildStorageKey(url: string) {
  return `${KEY_PREFIX}${url}`;
}

export async function getCachedFavicon(url: string): Promise<string | null> {
  if (!url || !isIndexedDbAvailable()) {
    return memoryFaviconCache.get(url) ?? null;
  }

  const memoryValue = memoryFaviconCache.get(url);

  if (memoryValue) {
    return memoryValue;
  }

  try {
    const result = await withStore<string | undefined>('readonly', (store) =>
      store.get(buildStorageKey(url))
    );
    if (typeof result === 'string') {
      memoryFaviconCache.set(url, result);
      return result;
    }

    return null;
  } catch {
    return memoryFaviconCache.get(url) ?? null;
  }
}

export async function saveCachedFavicon(url: string, dataUrl: string): Promise<void> {
  if (!url || !dataUrl || !isIndexedDbAvailable()) {
    if (url && dataUrl) {
      memoryFaviconCache.set(url, dataUrl);
    }
    return;
  }

  memoryFaviconCache.set(url, dataUrl);

  try {
    await withStore<IDBValidKey>('readwrite', (store) =>
      store.put(dataUrl, buildStorageKey(url))
    );
  } catch {
    // Ignore favicon cache write failures.
  }
}
