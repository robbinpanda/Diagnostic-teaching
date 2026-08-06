import type { DetectedProblemRegion, ProblemBoundingBox } from "./api/types";

const DATABASE_NAME = "ai4edu-client-state";
const STORE_NAME = "image-drafts";
const ACTIVE_DRAFT_KEY = "active";

export type PersistedImageStartItem = {
  region_id: string;
  session_id: string;
  client_message_id: string;
  bbox: ProblemBoundingBox;
};

export type PersistedImageDraft = {
  version: 1;
  operationId: string;
  stage: "pending" | "detecting" | "selecting" | "starting";
  imageBlob: Blob;
  contentType: string;
  filename: string;
  profileId: string;
  gradeBand: "junior" | "senior";
  regions: DetectedProblemRegion[];
  startItems?: PersistedImageStartItem[];
  paperId?: string;
  createdAt: string;
};

export type ImageDraftStore = {
  read(): Promise<unknown>;
  write(value: PersistedImageDraft): Promise<void>;
  remove(): Promise<void>;
};

function isBoundingBox(value: unknown): value is ProblemBoundingBox {
  if (!value || typeof value !== "object") return false;
  const box = value as Partial<ProblemBoundingBox>;
  return [box.x, box.y, box.width, box.height].every(
    (candidate) => typeof candidate === "number" && Number.isFinite(candidate)
  );
}

function isRegion(value: unknown): value is DetectedProblemRegion {
  if (!value || typeof value !== "object") return false;
  const region = value as Partial<DetectedProblemRegion>;
  return typeof region.id === "string"
    && typeof region.label === "string"
    && isBoundingBox(region.bbox);
}

function isStartItem(value: unknown): value is PersistedImageStartItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<PersistedImageStartItem>;
  return typeof item.region_id === "string"
    && typeof item.session_id === "string"
    && typeof item.client_message_id === "string"
    && isBoundingBox(item.bbox);
}

export function isPersistedImageDraft(value: unknown): value is PersistedImageDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<PersistedImageDraft>;
  return draft.version === 1
    && typeof draft.operationId === "string"
    && ["pending", "detecting", "selecting", "starting"].includes(String(draft.stage))
    && draft.imageBlob instanceof Blob
    && typeof draft.contentType === "string"
    && typeof draft.filename === "string"
    && typeof draft.profileId === "string"
    && (draft.gradeBand === "junior" || draft.gradeBand === "senior")
    && Array.isArray(draft.regions)
    && draft.regions.every(isRegion)
    && (draft.startItems === undefined
      || (Array.isArray(draft.startItems) && draft.startItems.every(isStartItem)))
    && (draft.paperId === undefined || typeof draft.paperId === "string")
    && typeof draft.createdAt === "string";
}

export function createImageDraftRecovery(store: ImageDraftStore) {
  return {
    async load() {
      const value = await store.read();
      if (isPersistedImageDraft(value)) return value;
      if (value !== undefined && value !== null) await store.remove();
      return null;
    },
    save(draft: PersistedImageDraft) {
      return store.write(draft);
    },
    clear() {
      return store.remove();
    }
  };
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
  });
}

function openDatabase(factory: IDBFactory) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
  });
}

function indexedDbStore(factory: IDBFactory): ImageDraftStore {
  return {
    async read() {
      const database = await openDatabase(factory);
      try {
        const transaction = database.transaction(STORE_NAME, "readonly");
        const completed = transactionDone(transaction);
        const value = await requestResult(transaction.objectStore(STORE_NAME).get(ACTIVE_DRAFT_KEY));
        await completed;
        return value;
      } finally {
        database.close();
      }
    },
    async write(value) {
      const database = await openDatabase(factory);
      try {
        const transaction = database.transaction(STORE_NAME, "readwrite");
        transaction.objectStore(STORE_NAME).put(value, ACTIVE_DRAFT_KEY);
        await transactionDone(transaction);
      } finally {
        database.close();
      }
    },
    async remove() {
      const database = await openDatabase(factory);
      try {
        const transaction = database.transaction(STORE_NAME, "readwrite");
        transaction.objectStore(STORE_NAME).delete(ACTIVE_DRAFT_KEY);
        await transactionDone(transaction);
      } finally {
        database.close();
      }
    }
  };
}

function browserRecovery() {
  if (typeof indexedDB === "undefined") return null;
  return createImageDraftRecovery(indexedDbStore(indexedDB));
}

export async function loadImageDraft() {
  return (await browserRecovery()?.load()) ?? null;
}

export async function saveImageDraft(draft: PersistedImageDraft) {
  await browserRecovery()?.save(draft);
}

export async function clearImageDraft() {
  await browserRecovery()?.clear();
}

export function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("图片草稿读取失败"));
    reader.readAsDataURL(blob);
  });
}
