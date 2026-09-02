export type OfflineImage = { name: string; type: string; lastModified: number; blob: Blob };
export type OfflineSubmission = {
  id: string;
  createdAt: number;
  expiresAt: number;
  context: Record<string, unknown>;
  images: OfflineImage[];
  attempts: number;
  lastError: string;
};

const DATABASE = "assetlens_offline_v1";
const STORE = "submissions";
const CACHE_STORE = "device_cache";
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(CACHE_STORE)) db.createObjectStore(CACHE_STORE, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Offline storage is unavailable."));
  });
}

async function transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>, storeName = STORE) {
  const db = await database();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(storeName, mode); const request = operation(tx.objectStore(storeName));
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error || new Error("Offline storage operation failed."));
    tx.oncomplete = () => db.close(); tx.onerror = () => { db.close(); reject(tx.error || new Error("Offline storage transaction failed.")); };
  });
}

export async function saveOfflineSubmission(files: File[], context: Record<string, unknown>) {
  const submission: OfflineSubmission = {
    id: crypto.randomUUID(), createdAt: Date.now(), expiresAt: Date.now() + RETENTION_MS, context,
    images: files.map(file => ({ name: file.name, type: file.type, lastModified: file.lastModified, blob: file.slice(0, file.size, file.type) })),
    attempts: 0, lastError: "",
  };
  await transaction("readwrite", store => store.put(submission));
  return submission;
}

export async function listOfflineSubmissions() {
  const rows = await transaction<OfflineSubmission[]>("readonly", store => store.getAll());
  return rows.filter(row => row.expiresAt > Date.now()).sort((a, b) => a.createdAt - b.createdAt);
}

export async function removeOfflineSubmission(id: string) { await transaction("readwrite", store => store.delete(id)); }

export async function updateOfflineSubmission(submission: OfflineSubmission) { await transaction("readwrite", store => store.put(submission)); }

export async function clearExpiredOfflineSubmissions() {
  const rows = await transaction<OfflineSubmission[]>("readonly", store => store.getAll());
  await Promise.all(rows.filter(row => row.expiresAt <= Date.now()).map(row => removeOfflineSubmission(row.id)));
}

export async function saveDeviceConfig(config: unknown) {
  await transaction("readwrite", store => store.put({ key: "master_config", value: config, savedAt: Date.now() }), CACHE_STORE);
}

export async function loadDeviceConfig<T>() {
  const row = await transaction<{ key: string; value: T; savedAt: number } | undefined>("readonly", store => store.get("master_config"), CACHE_STORE);
  return row?.value || null;
}

export function submissionFormData(submission: OfflineSubmission) {
  const form = new FormData();
  submission.images.forEach(image => form.append("images", new File([image.blob], image.name, { type: image.type, lastModified: image.lastModified })));
  form.append("context", JSON.stringify(submission.context));
  return form;
}
