import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  MIN_WORKSPACE_WIDTH,
  SIDEBAR_WIDTH_STORAGE_KEY,
  clampSidebarWidth,
  getSidebarWidthBounds,
  parseStoredSidebarWidth,
  readStoredSidebarWidth,
  writeStoredSidebarWidth
} from "../lib/sidebar-layout";

test("sidebar width keeps both desktop panes above their minimum widths", () => {
  const shellWidth = 1280;
  const bounds = getSidebarWidthBounds(shellWidth);

  assert.equal(bounds.min, MIN_SIDEBAR_WIDTH);
  assert.equal(bounds.max, shellWidth - MIN_WORKSPACE_WIDTH);
  assert.equal(clampSidebarWidth(80, shellWidth), MIN_SIDEBAR_WIDTH);
  assert.equal(clampSidebarWidth(900, shellWidth), shellWidth - MIN_WORKSPACE_WIDTH);
  assert.equal(clampSidebarWidth(344.4, shellWidth), 344);
});

test("sidebar bounds remain valid when the shell is narrower than both minima", () => {
  assert.deepEqual(getSidebarWidthBounds(400), {
    min: MIN_SIDEBAR_WIDTH,
    max: MIN_SIDEBAR_WIDTH
  });
  assert.equal(clampSidebarWidth(DEFAULT_SIDEBAR_WIDTH, Number.NaN), MIN_SIDEBAR_WIDTH);
});

test("stored sidebar widths reject empty and invalid values", () => {
  assert.equal(parseStoredSidebarWidth(null), DEFAULT_SIDEBAR_WIDTH);
  assert.equal(parseStoredSidebarWidth(""), DEFAULT_SIDEBAR_WIDTH);
  assert.equal(parseStoredSidebarWidth("not-a-number"), DEFAULT_SIDEBAR_WIDTH);
  assert.equal(parseStoredSidebarWidth("318"), 318);
});

test("sidebar persistence tolerates blocked browser storage", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    }
  };

  assert.equal(readStoredSidebarWidth(() => storage), DEFAULT_SIDEBAR_WIDTH);
  assert.equal(writeStoredSidebarWidth(() => null, 336), false);
  assert.equal(writeStoredSidebarWidth(() => storage, 336), true);
  assert.equal(values.get(SIDEBAR_WIDTH_STORAGE_KEY), "336");
  assert.equal(readStoredSidebarWidth(() => storage), 336);

  const blockedStorage = () => {
    throw new DOMException("blocked", "SecurityError");
  };
  assert.equal(readStoredSidebarWidth(blockedStorage), DEFAULT_SIDEBAR_WIDTH);
  assert.equal(writeStoredSidebarWidth(blockedStorage, 400), false);
});
