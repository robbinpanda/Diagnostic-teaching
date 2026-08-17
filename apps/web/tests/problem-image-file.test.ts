import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_PROBLEM_IMAGE_BYTES,
  problemImageFileError,
  readProblemImageAsDataUrl
} from "../lib/problem-image-file";

function fileMetadata(type: string, size: number) {
  return { type, size } as File;
}

test("problem images accept supported formats through the 12 MiB boundary", () => {
  for (const type of ["image/png", "image/jpeg", "image/webp"]) {
    assert.equal(problemImageFileError(fileMetadata(type, MAX_PROBLEM_IMAGE_BYTES)), null);
  }
});

test("oversized problem images are rejected before FileReader work starts", async () => {
  const oversized = fileMetadata("image/png", MAX_PROBLEM_IMAGE_BYTES + 1);
  let readerCalled = false;

  await assert.rejects(
    readProblemImageAsDataUrl(oversized, async () => {
      readerCalled = true;
      return "data:image/png;base64,ignored";
    }),
    /12MB/
  );
  assert.equal(readerCalled, false);
});

test("unsupported image formats are rejected before reading", async () => {
  const unsupported = fileMetadata("image/gif", 128);
  let readerCalled = false;

  await assert.rejects(
    readProblemImageAsDataUrl(unsupported, async () => {
      readerCalled = true;
      return "data:image/gif;base64,ignored";
    }),
    /PNG、JPEG 或 WebP/
  );
  assert.equal(readerCalled, false);
});

test("valid images are delegated to the data URL reader", async () => {
  const valid = fileMetadata("image/webp", 1024);
  const result = await readProblemImageAsDataUrl(
    valid,
    async (file) => `read:${file.type}:${file.size}`
  );

  assert.equal(result, "read:image/webp:1024");
});
