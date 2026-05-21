const DB_NAME = 'ai-tab-extension-db';
const STORE_NAME = 'assets';
const BACKGROUND_IMAGE_KEY = 'background-image';
const LOCAL_STORAGE_KEY = 'backgroundImageDataUrl';

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

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }

      reject(new Error('Failed to read the background image.'));
    };

    reader.onerror = () => {
      reject(reader.error ?? new Error('Failed to read the background image.'));
    };

    reader.readAsDataURL(file);
  });
}

function isIndexedDbAvailable() {
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';
}

export async function getBackgroundImage(): Promise<string | null> {
  if (!isIndexedDbAvailable()) {
    return window.localStorage.getItem(LOCAL_STORAGE_KEY);
  }

  try {
    const result = await withStore<string | undefined>('readonly', (store) =>
      store.get(BACKGROUND_IMAGE_KEY)
    );

    return result ?? null;
  } catch {
    return window.localStorage.getItem(LOCAL_STORAGE_KEY);
  }
}

export async function saveBackgroundImage(file: File): Promise<string> {
  const dataUrl = await readFileAsDataUrl(file);
  return saveBackgroundImageDataUrl(dataUrl);
}

export async function saveBackgroundImageDataUrl(dataUrl: string): Promise<string> {
  if (!dataUrl) {
    throw new Error('Background image data is empty.');
  }

  if (!isIndexedDbAvailable()) {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, dataUrl);
    return dataUrl;
  }

  try {
    await withStore<IDBValidKey>('readwrite', (store) => store.put(dataUrl, BACKGROUND_IMAGE_KEY));
    return dataUrl;
  } catch {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, dataUrl);
    return dataUrl;
  }
}

export async function removeBackgroundImage(): Promise<void> {
  if (!isIndexedDbAvailable()) {
    window.localStorage.removeItem(LOCAL_STORAGE_KEY);
    return;
  }

  try {
    await withStore<undefined>('readwrite', (store) => store.delete(BACKGROUND_IMAGE_KEY));
  } finally {
    window.localStorage.removeItem(LOCAL_STORAGE_KEY);
  }
}
