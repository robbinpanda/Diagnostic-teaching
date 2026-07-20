import assert from "node:assert/strict";
import test from "node:test";
import { mapWithConcurrency, MAX_PARALLEL_MODEL_TESTS } from "../lib/model-test-concurrency";

test("model tests run concurrently without exceeding the provider-safe limit", async () => {
  let active = 0;
  let peak = 0;
  const inputs = [1, 2, 3, 4, 5, 6, 7, 8];

  const results = await mapWithConcurrency(
    inputs,
    MAX_PARALLEL_MODEL_TESTS,
    async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return value * 2;
    }
  );

  assert.equal(peak, MAX_PARALLEL_MODEL_TESTS);
  assert.deepEqual(results, [2, 4, 6, 8, 10, 12, 14, 16]);
});
