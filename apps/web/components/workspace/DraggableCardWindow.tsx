"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject
} from "react";

import {
  cardWindowKeyboardCommand,
  clampCardWindowOffset,
  getCardWindowMaxHeight,
  type CardWindowPoint,
  type CardWindowRect
} from "../../lib/card-window-geometry";

const ZERO_OFFSET: CardWindowPoint = { x: 0, y: 0 };

type DragSession = {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startOffset: CardWindowPoint;
};

export type DraggableCardWindowHandle = {
  consumeOffsetAndReset: () => CardWindowPoint;
  reset: (options?: { focusHandle?: boolean }) => void;
  reclamp: () => void;
  focusHandle: () => void;
  getVisualRect: () => DOMRectReadOnly | null;
};

type Props = {
  cardId: string;
  mode: "pending" | "archived";
  boundsRef: RefObject<HTMLElement | null>;
  boundsKey: string;
  dragEnabled: boolean;
  onArchivedEscape?: () => void;
  children: ReactNode;
};

function restingRectFromVisualRect(
  visualRect: DOMRectReadOnly,
  appliedOffset: CardWindowPoint
): CardWindowRect {
  return {
    left: visualRect.left - appliedOffset.x,
    top: visualRect.top - appliedOffset.y,
    right: visualRect.right - appliedOffset.x,
    bottom: visualRect.bottom - appliedOffset.y,
    width: visualRect.width,
    height: visualRect.height
  };
}

export const DraggableCardWindow = forwardRef<DraggableCardWindowHandle, Props>(
  function DraggableCardWindow(
    { cardId, mode, boundsRef, boundsKey, dragEnabled, onArchivedEscape, children },
    forwardedRef
  ) {
    const rootRef = useRef<HTMLDivElement>(null);
    const offsetRef = useRef<CardWindowPoint>(ZERO_OFFSET);
    const appliedOffsetRef = useRef<CardWindowPoint>(ZERO_OFFSET);
    const pendingOffsetRef = useRef<CardWindowPoint>(ZERO_OFFSET);
    const dragSessionRef = useRef<DragSession | null>(null);
    const transformFrameRef = useRef<number | null>(null);
    const reclampFrameRef = useRef<number | null>(null);
    const [wideViewport, setWideViewport] = useState(false);
    const instructionsId = useId();
    const canDrag = dragEnabled && wideViewport;

    const cancelTransformFrame = useCallback(() => {
      if (transformFrameRef.current === null) return;
      window.cancelAnimationFrame(transformFrameRef.current);
      transformFrameRef.current = null;
    }, []);

    const releaseActivePointer = useCallback(() => {
      const pointerId = dragSessionRef.current?.pointerId;
      const root = rootRef.current;
      if (pointerId !== undefined && root?.hasPointerCapture(pointerId)) {
        root.releasePointerCapture(pointerId);
      }
      dragSessionRef.current = null;
      rootRef.current?.removeAttribute("data-dragging");
    }, []);

    const applyOffsetImmediately = useCallback((offset: CardWindowPoint) => {
      const root = rootRef.current;
      offsetRef.current = offset;
      pendingOffsetRef.current = offset;
      appliedOffsetRef.current = offset;
      if (!root) return;
      if (offset.x === 0 && offset.y === 0) {
        root.style.removeProperty("transform");
      } else {
        root.style.transform = `translate3d(${offset.x}px, ${offset.y}px, 0)`;
      }
    }, []);

    const scheduleOffset = useCallback((offset: CardWindowPoint) => {
      offsetRef.current = offset;
      pendingOffsetRef.current = offset;
      if (transformFrameRef.current !== null) return;
      transformFrameRef.current = window.requestAnimationFrame(() => {
        transformFrameRef.current = null;
        applyOffsetImmediately(pendingOffsetRef.current);
      });
    }, [applyOffsetImmediately]);

    const focusHandle = useCallback(() => {
      const target = canDrag
        ? rootRef.current
        : rootRef.current?.querySelector<HTMLElement>(
            'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
          );
      target?.focus({ preventScroll: true });
    }, [canDrag]);

    const reset = useCallback((options?: { focusHandle?: boolean }) => {
      releaseActivePointer();
      cancelTransformFrame();
      applyOffsetImmediately(ZERO_OFFSET);
      if (options?.focusHandle) focusHandle();
    }, [applyOffsetImmediately, cancelTransformFrame, focusHandle, releaseActivePointer]);

    const clampedOffset = useCallback((candidate: CardWindowPoint) => {
      const root = rootRef.current;
      const bounds = boundsRef.current;
      if (!root || !bounds) return candidate;
      const restingRect = restingRectFromVisualRect(
        root.getBoundingClientRect(),
        appliedOffsetRef.current
      );
      return clampCardWindowOffset(restingRect, bounds.getBoundingClientRect(), candidate);
    }, [boundsRef]);

    const reclamp = useCallback(() => {
      const root = rootRef.current;
      const bounds = boundsRef.current;
      if (!root || !bounds || !wideViewport) return;

      const boundsRect = bounds.getBoundingClientRect();
      const maxHeight = `${getCardWindowMaxHeight(boundsRect)}px`;
      if (root.style.getPropertyValue("--card-window-max-height") !== maxHeight) {
        root.style.setProperty("--card-window-max-height", maxHeight);
      }
      if (canDrag) scheduleOffset(clampedOffset(offsetRef.current));
    }, [boundsRef, canDrag, clampedOffset, scheduleOffset, wideViewport]);

    const scheduleReclamp = useCallback(() => {
      if (reclampFrameRef.current !== null) return;
      reclampFrameRef.current = window.requestAnimationFrame(() => {
        reclampFrameRef.current = null;
        reclamp();
      });
    }, [reclamp]);

    const consumeOffsetAndReset = useCallback(() => {
      const offset = { ...offsetRef.current };
      reset();
      return offset;
    }, [reset]);

    useImperativeHandle(forwardedRef, () => ({
      consumeOffsetAndReset,
      reset,
      reclamp,
      focusHandle,
      getVisualRect: () => rootRef.current?.getBoundingClientRect() ?? null
    }), [consumeOffsetAndReset, focusHandle, reclamp, reset]);

    useEffect(() => {
      const mediaQuery = window.matchMedia("(min-width: 901px)");
      const updateViewport = () => setWideViewport(mediaQuery.matches);
      updateViewport();
      mediaQuery.addEventListener("change", updateViewport);
      return () => mediaQuery.removeEventListener("change", updateViewport);
    }, []);

    useEffect(() => {
      reset();
    }, [cardId, reset]);

    useEffect(() => {
      if (!wideViewport) {
        rootRef.current?.style.removeProperty("--card-window-max-height");
        reset();
        return;
      }

      if (!canDrag) releaseActivePointer();

      const root = rootRef.current;
      const bounds = boundsRef.current;
      if (!root || !bounds) return;

      const observer = new ResizeObserver(scheduleReclamp);
      observer.observe(root);
      observer.observe(bounds);
      window.addEventListener("resize", scheduleReclamp);
      scheduleReclamp();

      return () => {
        observer.disconnect();
        window.removeEventListener("resize", scheduleReclamp);
      };
    }, [boundsKey, boundsRef, canDrag, releaseActivePointer, reset, scheduleReclamp, wideViewport]);

    useEffect(() => () => {
      releaseActivePointer();
      cancelTransformFrame();
      if (reclampFrameRef.current !== null) {
        window.cancelAnimationFrame(reclampFrameRef.current);
      }
    }, [cancelTransformFrame, releaseActivePointer]);

    function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
      if (!canDrag || !event.isPrimary || event.button !== 0) return;
      const target = event.target;
      if (target instanceof Element && target.closest(
        "button, input, select, textarea, a, [contenteditable='true'], [data-no-card-drag]"
      )) return;
      dragSessionRef.current = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startOffset: { ...offsetRef.current }
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      event.currentTarget.focus({ preventScroll: true });
      rootRef.current?.setAttribute("data-dragging", "true");
      event.preventDefault();
    }

    function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
      const dragSession = dragSessionRef.current;
      if (!canDrag || !dragSession || dragSession.pointerId !== event.pointerId) return;
      scheduleOffset(clampedOffset({
        x: dragSession.startOffset.x + event.clientX - dragSession.startClientX,
        y: dragSession.startOffset.y + event.clientY - dragSession.startClientY
      }));
      event.preventDefault();
    }

    function finishPointerDrag(event: ReactPointerEvent<HTMLDivElement>) {
      if (dragSessionRef.current?.pointerId !== event.pointerId) return;
      releaseActivePointer();
      scheduleReclamp();
    }

    function handleWindowMoveKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
      if (!canDrag) return;
      if (event.target !== event.currentTarget) return;
      const command = cardWindowKeyboardCommand(event.key, event.shiftKey);
      if (!command) return;
      event.preventDefault();
      if (command.kind === "reset") {
        reset({ focusHandle: true });
        return;
      }
      scheduleOffset(clampedOffset({
        x: offsetRef.current.x + command.delta.x,
        y: offsetRef.current.y + command.delta.y
      }));
    }

    function handleWindowKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
      if (event.key === "Escape") {
        if (mode === "archived") {
          if (!onArchivedEscape) return;
          event.preventDefault();
          event.stopPropagation();
          onArchivedEscape();
          return;
        }
        if (!canDrag) return;
        event.preventDefault();
        event.stopPropagation();
        reset({ focusHandle: true });
        return;
      }
      handleWindowMoveKeyDown(event);
    }

    return (
      <div
        ref={rootRef}
        className="draggableCardWindow"
        data-card-id={cardId}
        data-card-window-mode={mode}
        data-drag-enabled={canDrag ? "true" : "false"}
        tabIndex={canDrag ? 0 : undefined}
        role="region"
        aria-label={canDrag ? "可移动卡片窗口" : "卡片窗口"}
        aria-describedby={canDrag ? instructionsId : undefined}
        aria-keyshortcuts={canDrag
          ? "ArrowUp ArrowDown ArrowLeft ArrowRight Shift+ArrowUp Shift+ArrowDown Shift+ArrowLeft Shift+ArrowRight Home"
          : undefined}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointerDrag}
        onPointerCancel={finishPointerDrag}
        onLostPointerCapture={finishPointerDrag}
        onKeyDown={handleWindowKeyDown}
      >
        <span id={instructionsId} className="srOnly">
          拖动卡片的非交互区域可以移动窗口。使用方向键每次移动 16 像素；按住 Shift 使用方向键时每次移动 4 像素；按 Home 回到初始位置。
        </span>
        {children}
      </div>
    );
  }
);
