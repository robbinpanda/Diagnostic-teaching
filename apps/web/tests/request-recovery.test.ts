import assert from "node:assert/strict";
import test from "node:test";
import {
  clearAllRequestRecovery,
  clearComposerDraft,
  clearPendingSessionBatch,
  clearPendingStudentRequest,
  listPendingStudentRequests,
  loadActiveSessionId,
  loadComposerDraft,
  loadPendingSessionBatch,
  saveActiveSessionId,
  saveComposerDraft,
  savePendingSessionBatch,
  savePendingStudentRequest,
  type StorageLike
} from "../lib/request-recovery";

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

test("session batch recovery keeps stable SQLite idempotency keys until acceptance", () => {
  const storage = new MemoryStorage();
  const batch = {
    operationId: "operation-1",
    text: "解答方程 x+1=2",
    profileId: "profile-1",
    gradeBand: "junior" as const,
    createdAt: "2026-08-02T00:00:00Z",
    sessions: [{
      session_id: "sess-stable",
      client_message_id: "message-stable",
      grade_band: "junior" as const,
      subject: "math" as const,
      model_profile_id: "profile-1",
      message: "解答方程 x+1=2",
      problem_text: "解答方程 x+1=2",
      student_initial_thought: "",
      problem_image_data_url: null
    }]
  };

  savePendingSessionBatch(storage, batch);
  assert.deepEqual(loadPendingSessionBatch(storage), batch);
  clearPendingSessionBatch(storage, "another-operation");
  assert.deepEqual(loadPendingSessionBatch(storage), batch);
  clearPendingSessionBatch(storage, batch.operationId);
  assert.equal(loadPendingSessionBatch(storage), null);
});

test("student outbox keeps one stable request per session and preserves other sessions", () => {
  const storage = new MemoryStorage();
  const first = {
    operationId: "operation-a",
    sessionId: "session-a",
    text: "第一条",
    clientMessageId: "message-a",
    createdAt: "2026-08-02T00:00:00Z"
  };
  const replacement = {
    ...first,
    operationId: "operation-a2",
    text: "修正后的第一条",
    clientMessageId: "message-a2"
  };
  const second = {
    operationId: "operation-b",
    sessionId: "session-b",
    text: "第二条",
    clientMessageId: "message-b",
    createdAt: "2026-08-02T00:00:01Z"
  };

  savePendingStudentRequest(storage, first);
  savePendingStudentRequest(storage, second);
  savePendingStudentRequest(storage, replacement);
  assert.deepEqual(listPendingStudentRequests(storage), [second, replacement]);
  clearPendingStudentRequest(storage, replacement.operationId);
  assert.deepEqual(listPendingStudentRequests(storage), [second]);
});

test("active session and composer drafts survive refresh without crossing session scopes", () => {
  const storage = new MemoryStorage();
  saveActiveSessionId(storage, "session-a");
  saveComposerDraft(storage, "draft", "新题草稿");
  saveComposerDraft(storage, "session-a", "会话追问草稿");

  assert.equal(loadActiveSessionId(storage), "session-a");
  assert.equal(loadComposerDraft(storage, "draft"), "新题草稿");
  assert.equal(loadComposerDraft(storage, "session-a"), "会话追问草稿");

  clearComposerDraft(storage, "session-a");
  saveActiveSessionId(storage, "");
  assert.equal(loadActiveSessionId(storage), "");
  assert.equal(loadComposerDraft(storage, "session-a"), "");
  assert.equal(loadComposerDraft(storage, "draft"), "新题草稿");

  clearAllRequestRecovery(storage);
  assert.equal(loadActiveSessionId(storage), "");
  assert.equal(loadComposerDraft(storage, "draft"), "");
});

test("malformed browser recovery data is ignored safely", () => {
  const storage = new MemoryStorage();
  storage.setItem("ai4edu.request-recovery.v1", "{not-json");
  storage.setItem("ai4edu.composer-drafts.v1", "[]");
  assert.equal(loadPendingSessionBatch(storage), null);
  assert.deepEqual(listPendingStudentRequests(storage), []);
  assert.equal(loadComposerDraft(storage, "draft"), "");
});
