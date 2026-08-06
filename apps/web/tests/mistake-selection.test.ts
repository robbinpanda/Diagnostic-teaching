import assert from "node:assert/strict";
import test from "node:test";

import {
  selectedHistoryItems,
  toggleMistakeSelection,
  togglePaperMistakeSelection
} from "../lib/mistake-selection";


test("mistake selection keeps cross-paper order and toggles individual questions", () => {
  assert.deepEqual(toggleMistakeSelection(["a", "b"], "a"), ["b"]);
  assert.deepEqual(toggleMistakeSelection(["a"], "c"), ["a", "c"]);
  assert.deepEqual(togglePaperMistakeSelection(["a"], ["b", "c"]), ["a", "b", "c"]);
  assert.deepEqual(togglePaperMistakeSelection(["a", "b", "c"], ["b", "c"]), ["a"]);
});


test("selected history items follow the user's selection order and drop stale ids", () => {
  const items = [
    { session_id: "a", title: "A" },
    { session_id: "b", title: "B" }
  ];
  assert.deepEqual(selectedHistoryItems(items, ["b", "missing", "a"]), [items[1], items[0]]);
});
