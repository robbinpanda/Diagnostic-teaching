export const CARD_WINDOW_EDGE_INSET = 12;
export const CARD_WINDOW_MOVE_STEP = 16;
export const CARD_WINDOW_FINE_MOVE_STEP = 4;

export type CardWindowPoint = {
  x: number;
  y: number;
};

export type CardWindowRect = Pick<
  DOMRectReadOnly,
  "left" | "top" | "right" | "bottom" | "width" | "height"
>;

export type CardWindowKeyboardCommand =
  | { kind: "move"; delta: CardWindowPoint }
  | { kind: "reset" };

export type CardWindowTransitionMotion = {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
};

function clampAxis(value: number, minimum: number, maximum: number) {
  if (minimum <= maximum) return Math.min(Math.max(value, minimum), maximum);
  return (minimum + maximum) / 2;
}

export function clampCardWindowOffset(
  restingRect: CardWindowRect,
  boundsRect: CardWindowRect,
  candidateOffset: CardWindowPoint,
  inset = CARD_WINDOW_EDGE_INSET
): CardWindowPoint {
  const safeInset = Math.max(0, Number.isFinite(inset) ? inset : CARD_WINDOW_EDGE_INSET);
  const x = Number.isFinite(candidateOffset.x) ? candidateOffset.x : 0;
  const y = Number.isFinite(candidateOffset.y) ? candidateOffset.y : 0;

  return {
    x: clampAxis(
      x,
      boundsRect.left + safeInset - restingRect.left,
      boundsRect.right - safeInset - restingRect.right
    ),
    y: clampAxis(
      y,
      boundsRect.top + safeInset - restingRect.top,
      boundsRect.bottom - safeInset - restingRect.bottom
    )
  };
}

export function getCardWindowMaxHeight(
  boundsRect: CardWindowRect,
  inset = CARD_WINDOW_EDGE_INSET
) {
  const safeInset = Math.max(0, Number.isFinite(inset) ? inset : CARD_WINDOW_EDGE_INSET);
  return Math.max(0, boundsRect.height - safeInset * 2);
}

export function cardWindowKeyboardCommand(
  key: string,
  shiftKey: boolean
): CardWindowKeyboardCommand | null {
  if (key === "Home") return { kind: "reset" };

  const step = shiftKey ? CARD_WINDOW_FINE_MOVE_STEP : CARD_WINDOW_MOVE_STEP;
  if (key === "ArrowUp") return { kind: "move", delta: { x: 0, y: -step } };
  if (key === "ArrowDown") return { kind: "move", delta: { x: 0, y: step } };
  if (key === "ArrowLeft") return { kind: "move", delta: { x: -step, y: 0 } };
  if (key === "ArrowRight") return { kind: "move", delta: { x: step, y: 0 } };
  return null;
}

export function rectTransitionMotion(
  restingRect: CardWindowRect,
  targetRect: CardWindowRect
): CardWindowTransitionMotion {
  return {
    x: targetRect.left - restingRect.left,
    y: targetRect.top - restingRect.top,
    scaleX: restingRect.width > 0 ? targetRect.width / restingRect.width : 1,
    scaleY: restingRect.height > 0 ? targetRect.height / restingRect.height : 1
  };
}
