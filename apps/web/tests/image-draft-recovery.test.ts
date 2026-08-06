import assert from "node:assert/strict";
import test from "node:test";
import {
  createImageDraftRecovery,
  isPersistedImageDraft,
  type ImageDraftStore,
  type PersistedImageDraft
} from "../lib/image-draft-recovery";

class MemoryImageDraftStore implements ImageDraftStore {
  value: unknown = null;

  async read() {
    return this.value;
  }

  async write(value: PersistedImageDraft) {
    this.value = value;
  }

  async remove() {
    this.value = null;
  }
}

function draft(): PersistedImageDraft {
  return {
    version: 1,
    operationId: "image-operation-1",
    stage: "starting",
    imageBlob: new Blob(["image"], { type: "image/png" }),
    contentType: "image/png",
    filename: "problem.png",
    profileId: "profile-vision",
    gradeBand: "junior",
    regions: [{
      id: "problem-1",
      label: "题目 1",
      bbox: { x: 0.1, y: 0.2, width: 0.7, height: 0.5 }
    }],
    startItems: [{
      region_id: "problem-1",
      session_id: "sess_stable",
      client_message_id: "message-stable",
      bbox: { x: 0.1, y: 0.2, width: 0.7, height: 0.5 }
    }],
    paperId: "paper_123456789abc",
    createdAt: "2026-08-05T00:00:00Z"
  };
}

test("image draft recovery preserves blob, edited regions, and stable start ids", async () => {
  const store = new MemoryImageDraftStore();
  const recovery = createImageDraftRecovery(store);
  const pending = draft();

  await recovery.save(pending);
  const restored = await recovery.load();

  assert.equal(restored?.imageBlob.size, 5);
  assert.deepEqual(restored?.regions, pending.regions);
  assert.deepEqual(restored?.startItems, pending.startItems);
  assert.equal(restored?.paperId, pending.paperId);
  await recovery.clear();
  assert.equal(await recovery.load(), null);
});

test("malformed IndexedDB image drafts are discarded", async () => {
  const store = new MemoryImageDraftStore();
  store.value = { ...draft(), imageBlob: "not-a-blob" };
  const recovery = createImageDraftRecovery(store);

  assert.equal(isPersistedImageDraft(store.value), false);
  assert.equal(await recovery.load(), null);
  assert.equal(store.value, null);
});
