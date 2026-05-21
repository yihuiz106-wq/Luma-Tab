const DB_NAME = 'ai-tab-extension-secure-db';
const KEY_STORE_NAME = 'crypto-keys';
const SECRET_STORE_NAME = 'encrypted-secrets';
const API_KEY_SECRET_ID = 'deepseek-api-key';
const API_KEY_CRYPTO_KEY_ID = 'deepseek-api-key-encryption-key';

interface EncryptedSecretPayload {
  ciphertext: string;
  iv: string;
}

function isIndexedDbAvailable() {
  return typeof indexedDB !== 'undefined';
}

function isCryptoAvailable() {
  return typeof crypto !== 'undefined' && typeof crypto.subtle !== 'undefined';
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(KEY_STORE_NAME)) {
        database.createObjectStore(KEY_STORE_NAME);
      }

      if (!database.objectStoreNames.contains(SECRET_STORE_NAME)) {
        database.createObjectStore(SECRET_STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to initialize secure storage.'));
  });
}

async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const database = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    const request = callback(store);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Secure storage read/write failed.'));
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => reject(transaction.error ?? new Error('Secure storage transaction failed.'));
  });
}

async function getOrCreateEncryptionKey(): Promise<CryptoKey> {
  const existingKey = await withStore<CryptoKey | undefined>(KEY_STORE_NAME, 'readonly', (store) =>
    store.get(API_KEY_CRYPTO_KEY_ID)
  );

  if (existingKey) {
    return existingKey;
  }

  const nextKey = await crypto.subtle.generateKey(
    {
      name: 'AES-GCM',
      length: 256
    },
    false,
    ['encrypt', 'decrypt']
  );

  await withStore<IDBValidKey>(KEY_STORE_NAME, 'readwrite', (store) =>
    store.put(nextKey, API_KEY_CRYPTO_KEY_ID)
  );

  return nextKey;
}

function encodeBase64(bytes: Uint8Array) {
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function decodeBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function isEncryptedSecretPayload(value: unknown): value is EncryptedSecretPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate.ciphertext === 'string' && typeof candidate.iv === 'string';
}

export async function saveEncryptedApiKey(secret: string): Promise<void> {
  if (!isIndexedDbAvailable() || !isCryptoAvailable()) {
    throw new Error('Encrypted storage is not supported in this environment.');
  }

  const encryptionKey = await getOrCreateEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encodedSecret = new TextEncoder().encode(secret);
  const ciphertextBuffer = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv
    },
    encryptionKey,
    encodedSecret
  );

  const payload: EncryptedSecretPayload = {
    ciphertext: encodeBase64(new Uint8Array(ciphertextBuffer)),
    iv: encodeBase64(iv)
  };

  await withStore<IDBValidKey>(SECRET_STORE_NAME, 'readwrite', (store) => store.put(payload, API_KEY_SECRET_ID));
}

export async function getEncryptedApiKey(): Promise<string | null> {
  if (!isIndexedDbAvailable() || !isCryptoAvailable()) {
    return null;
  }

  const payload = await withStore<EncryptedSecretPayload | undefined>(SECRET_STORE_NAME, 'readonly', (store) =>
    store.get(API_KEY_SECRET_ID)
  );

  if (!isEncryptedSecretPayload(payload)) {
    return null;
  }

  const encryptionKey = await getOrCreateEncryptionKey();
  const decryptedBuffer = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: decodeBase64(payload.iv)
    },
    encryptionKey,
    decodeBase64(payload.ciphertext)
  );

  return new TextDecoder().decode(decryptedBuffer);
}

export async function clearEncryptedApiKey(): Promise<void> {
  if (!isIndexedDbAvailable()) {
    return;
  }

  await withStore<undefined>(SECRET_STORE_NAME, 'readwrite', (store) => store.delete(API_KEY_SECRET_ID));
}
