import type { SessionStartInput } from "./api/types";

const REQUEST_RECOVERY_KEY = "ai4edu.request-recovery.v1";
const ACTIVE_SESSION_KEY = "ai4edu.active-session.v1";
const COMPOSER_DRAFTS_KEY = "ai4edu.composer-drafts.v1";

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type PendingSessionBatch = {
  operationId: string;
  text: string;
  profileId: string;
  gradeBand: "junior" | "senior";
  createdAt: string;
  sessions?: SessionStartInput[];
};

export type PendingStudentRequest = {
  operationId: string;
  sessionId: string;
  text: string;
  clientMessageId: string;
  createdAt: string;
};

type RecoveryEnvelope = {
  version: 1;
  sessionBatch: PendingSessionBatch | null;
  studentRequests: PendingStudentRequest[];
};

const EMPTY_ENVELOPE: RecoveryEnvelope = {
  version: 1,
  sessionBatch: null,
  studentRequests: []
};

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isPendingSessionBatch(value: unknown): value is PendingSessionBatch {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PendingSessionBatch>;
  return isString(candidate.operationId)
    && isString(candidate.text)
    && isString(candidate.profileId)
    && (candidate.gradeBand === "junior" || candidate.gradeBand === "senior")
    && isString(candidate.createdAt)
    && (candidate.sessions === undefined || Array.isArray(candidate.sessions));
}

function isPendingStudentRequest(value: unknown): value is PendingStudentRequest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PendingStudentRequest>;
  return isString(candidate.operationId)
    && isString(candidate.sessionId)
    && isString(candidate.text)
    && isString(candidate.clientMessageId)
    && isString(candidate.createdAt);
}

function readEnvelope(storage: StorageLike): RecoveryEnvelope {
  try {
    const raw = storage.getItem(REQUEST_RECOVERY_KEY);
    if (!raw) return { ...EMPTY_ENVELOPE, studentRequests: [] };
    const parsed = JSON.parse(raw) as Partial<RecoveryEnvelope>;
    if (parsed.version !== 1) return { ...EMPTY_ENVELOPE, studentRequests: [] };
    return {
      version: 1,
      sessionBatch: isPendingSessionBatch(parsed.sessionBatch) ? parsed.sessionBatch : null,
      studentRequests: Array.isArray(parsed.studentRequests)
        ? parsed.studentRequests.filter(isPendingStudentRequest)
        : []
    };
  } catch {
    return { ...EMPTY_ENVELOPE, studentRequests: [] };
  }
}

function writeEnvelope(storage: StorageLike, envelope: RecoveryEnvelope) {
  if (!envelope.sessionBatch && envelope.studentRequests.length === 0) {
    storage.removeItem(REQUEST_RECOVERY_KEY);
    return;
  }
  storage.setItem(REQUEST_RECOVERY_KEY, JSON.stringify(envelope));
}

export function loadPendingSessionBatch(storage: StorageLike) {
  return readEnvelope(storage).sessionBatch;
}

export function savePendingSessionBatch(storage: StorageLike, batch: PendingSessionBatch) {
  const envelope = readEnvelope(storage);
  writeEnvelope(storage, { ...envelope, sessionBatch: batch });
}

export function clearPendingSessionBatch(storage: StorageLike, operationId: string) {
  const envelope = readEnvelope(storage);
  if (envelope.sessionBatch?.operationId !== operationId) return;
  writeEnvelope(storage, { ...envelope, sessionBatch: null });
}

export function listPendingStudentRequests(storage: StorageLike) {
  return readEnvelope(storage).studentRequests;
}

export function savePendingStudentRequest(storage: StorageLike, request: PendingStudentRequest) {
  const envelope = readEnvelope(storage);
  writeEnvelope(storage, {
    ...envelope,
    studentRequests: [
      ...envelope.studentRequests.filter((candidate) => candidate.sessionId !== request.sessionId),
      request
    ]
  });
}

export function clearPendingStudentRequest(storage: StorageLike, operationId: string) {
  const envelope = readEnvelope(storage);
  writeEnvelope(storage, {
    ...envelope,
    studentRequests: envelope.studentRequests.filter(
      (candidate) => candidate.operationId !== operationId
    )
  });
}

export function clearPendingStudentRequestsForSession(storage: StorageLike, sessionId: string) {
  const envelope = readEnvelope(storage);
  writeEnvelope(storage, {
    ...envelope,
    studentRequests: envelope.studentRequests.filter(
      (candidate) => candidate.sessionId !== sessionId
    )
  });
}

export function saveActiveSessionId(storage: StorageLike, sessionId: string) {
  if (sessionId) storage.setItem(ACTIVE_SESSION_KEY, sessionId);
  else storage.removeItem(ACTIVE_SESSION_KEY);
}

export function loadActiveSessionId(storage: StorageLike) {
  return storage.getItem(ACTIVE_SESSION_KEY) ?? "";
}

function readDrafts(storage: StorageLike): Record<string, string> {
  try {
    const parsed = JSON.parse(storage.getItem(COMPOSER_DRAFTS_KEY) ?? "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => isString(entry[1]))
    );
  } catch {
    return {};
  }
}

export function loadComposerDraft(storage: StorageLike, scope: string) {
  return readDrafts(storage)[scope] ?? "";
}

export function saveComposerDraft(storage: StorageLike, scope: string, text: string) {
  const drafts = readDrafts(storage);
  if (text) drafts[scope] = text;
  else delete drafts[scope];
  if (Object.keys(drafts).length === 0) storage.removeItem(COMPOSER_DRAFTS_KEY);
  else storage.setItem(COMPOSER_DRAFTS_KEY, JSON.stringify(drafts));
}

export function clearComposerDraft(storage: StorageLike, scope: string) {
  saveComposerDraft(storage, scope, "");
}

export function clearAllRequestRecovery(storage: StorageLike) {
  storage.removeItem(REQUEST_RECOVERY_KEY);
  storage.removeItem(ACTIVE_SESSION_KEY);
  storage.removeItem(COMPOSER_DRAFTS_KEY);
}
