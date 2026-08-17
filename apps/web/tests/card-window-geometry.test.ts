import assert from "node:assert/strict";
import test from "node:test";

import {
  CARD_WINDOW_EDGE_INSET,
  CARD_WINDOW_FINE_MOVE_STEP,
  CARD_WINDOW_MOVE_STEP,
  cardWindowKeyboardCommand,
  clampCardWindowOffset,
  getCardWindowMaxHeight,
  rectTransitionMotion
} from "../lib/card-window-geometry";

const restingRect = {
  left: 200,
  top: 100,
  right: 600,
  bottom: 500,
  width: 400,
  height: 400
};

const boundsRect = {
  left: 100,
  top: 50,
  right: 900,
  bottom: 700,
  width: 800,
  height: 650
};

test("card window offsets stay inside the message viewport inset", () => {
  assert.equal(CARD_WINDOW_EDGE_INSET, 12);
  assert.deepEqual(
    clampCardWindowOffset(restingRect, boundsRect, { x: -500, y: 500 }),
    { x: -88, y: 188 }
  );
  assert.deepEqual(
    clampCardWindowOffset(restingRect, boundsRect, { x: 24, y: -20 }),
    { x: 24, y: -20 }
  );
});

test("oversized card windows settle on the midpoint instead of producing invalid offsets", () => {
  const oversizedRect = {
    left: 0,
    top: 0,
    right: 1000,
    bottom: 900,
    width: 1000,
    height: 900
  };

  assert.deepEqual(
    clampCardWindowOffset(oversizedRect, boundsRect, { x: 800, y: -800 }),
    { x: 0, y: -75 }
  );
  assert.equal(getCardWindowMaxHeight(boundsRect), 626);
});

test("card window keyboard commands use normal and fine-grained movement", () => {
  assert.equal(CARD_WINDOW_MOVE_STEP, 16);
  assert.equal(CARD_WINDOW_FINE_MOVE_STEP, 4);
  assert.deepEqual(cardWindowKeyboardCommand("ArrowLeft", false), {
    kind: "move",
    delta: { x: -16, y: 0 }
  });
  assert.deepEqual(cardWindowKeyboardCommand("ArrowDown", true), {
    kind: "move",
    delta: { x: 0, y: 4 }
  });
  assert.deepEqual(cardWindowKeyboardCommand("Home", false), { kind: "reset" });
  assert.equal(cardWindowKeyboardCommand("Enter", false), null);
});

test("rect transition motion maps the resting card to its visible source", () => {
  assert.deepEqual(
    rectTransitionMotion(restingRect, {
      left: 900,
      top: 40,
      right: 950,
      bottom: 140,
      width: 50,
      height: 100
    }),
    { x: 700, y: -60, scaleX: 0.125, scaleY: 0.25 }
  );
});
