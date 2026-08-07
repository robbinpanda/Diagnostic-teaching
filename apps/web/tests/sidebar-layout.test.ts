import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  MIN_WORKSPACE_WIDTH,
  clampSidebarWidth,
  getSidebarWidthBounds,
  parseStoredSidebarWidth
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
