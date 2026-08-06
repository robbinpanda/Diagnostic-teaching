"use client";

import { GripVertical } from "lucide-react";
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
    const handleRef = useRef<HTMLButtonElement>(null);
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
      const handle = handleRef.current;
      if (pointerId !== undefined && handle?.hasPointerCapture(pointerId)) {
        handle.releasePointerCapture(pointerId);
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
        ? handleRef.current
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

    function handlePointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
      if (!canDrag || !event.isPrimary || event.button !== 0) return;
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

    function handlePointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
      const dragSession = dragSessionRef.current;
      if (!canDrag || !dragSession || dragSession.pointerId !== event.pointerId) return;
      scheduleOffset(clampedOffset({
        x: dragSession.startOffset.x + event.clientX - dragSession.startClientX,
        y: dragSession.startOffset.y + event.clientY - dragSession.startClientY
      }));
      event.preventDefault();
    }

    function finishPointerDrag(event: ReactPointerEvent<HTMLButtonElement>) {
      if (dragSessionRef.current?.pointerId !== event.pointerId) return;
      releaseActivePointer();
      scheduleReclamp();
    }

    function handleHandleKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
      if (!canDrag) return;
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
      if (event.key !== "Escape") return;
      if (mode === "archived") {
        if (!onArchivedEscape) return;
        event.preventDefault();
        event.stopPropagation();
        onArchivedEscape?.();
        return;
      }
      if (!canDrag) return;
      event.preventDefault();
      event.stopPropagation();
      reset({ focusHandle: true });
    }

    return (
      <div
        ref={rootRef}
        className="draggableCardWindow"
        data-card-id={cardId}
        data-card-window-mode={mode}
        data-drag-enabled={canDrag ? "true" : "false"}
        onKeyDownCapture={handleWindowKeyDown}
      >
        <button
          ref={handleRef}
          className="cardWindowDragHandle"
          type="button"
          disabled={!canDrag}
          aria-hidden={canDrag ? undefined : true}
          aria-label="移动卡片窗口"
          aria-describedby={instructionsId}
          aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Shift+ArrowUp Shift+ArrowDown Shift+ArrowLeft Shift+ArrowRight Home"
          title="拖动卡片；方向键移动，Shift + 方向键微调，Home 复位"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishPointerDrag}
          onPointerCancel={finishPointerDrag}
          onLostPointerCapture={finishPointerDrag}
          onKeyDown={handleHandleKeyDown}
        >
          <GripVertical size={18} aria-hidden="true" />
        </button>
        <span id={instructionsId} className="srOnly">
          使用方向键移动卡片窗口，每次移动 16 像素；按住 Shift 使用方向键时每次移动 4 像素；按 Home 回到初始位置。
        </span>
        {children}
      </div>
    );
  }
);
