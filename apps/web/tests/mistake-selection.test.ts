import assert from "node:assert/strict";
import test from "node:test";

import {
  toggleMistakeCardGroupSelection,
  toggleMistakeCardSelection
} from "../lib/mistake-selection";


test("mistake selection keeps cross-paper order and toggles individual questions", () => {
  assert.deepEqual(toggleMistakeCardSelection(["a", "b"], "a"), ["b"]);
  assert.deepEqual(toggleMistakeCardSelection(["a"], "c"), ["a", "c"]);
  assert.deepEqual(toggleMistakeCardGroupSelection(["a"], ["b", "c"]), ["a", "b", "c"]);
  assert.deepEqual(toggleMistakeCardGroupSelection(["a", "b", "c"], ["b", "c"]), ["a"]);
});
