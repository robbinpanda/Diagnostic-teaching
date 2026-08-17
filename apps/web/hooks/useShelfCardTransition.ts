"use client";

import { useEffect, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { flushSync } from "react-dom";
import type { DraggableCardWindowHandle } from "../components/workspace/DraggableCardWindow";
import type { StudyCard } from "../lib/api";

export type ShelfCardTransitionPhase =
  | "idle"
  | "preparing"
  | "opening"
  | "open"
  | "closing"
  | "closingFallback";

export type ShelfCardMotion = {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  startX?: number;
  startY?: number;
};

function hasUsableSourceVisibility(element: HTMLElement, allowHiddenSource: boolean) {
  let current: HTMLElement | null = element;
  let isSource = true;
  while (current) {
    const style = window.getComputedStyle(current);
    const hiddenSourceAllowed = isSource && allowHiddenSource;
    if (
      style.display === "none"
      || (style.visibility === "hidden" && !hiddenSourceAllowed)
      || Number.parseFloat(style.opacity) === 0
      || (style.pointerEvents === "none" && !hiddenSourceAllowed)
    ) return false;
    current = current.parentElement;
    isSource = false;
  }
  return true;
}

function isSourceOnScreen(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  return rect.width > 0
    && rect.height > 0
    && rect.right > 0
    && rect.bottom > 0
    && rect.left < window.innerWidth
    && rect.top < window.innerHeight;
}

function canReturnToElement(element: HTMLElement | null): element is HTMLElement {
  return Boolean(
    element?.isConnected
    && hasUsableSourceVisibility(element, false)
    && isSourceOnScreen(element)
  );
}

function canAnimateToElement(element: HTMLElement | null): element is HTMLElement {
  if (!element?.isConnected) return false;
  const intentionallyHiddenShelfSource = element.matches("[data-shelf-card-id]");
  return hasUsableSourceVisibility(element, intentionallyHiddenShelfSource)
    && isSourceOnScreen(element);
}

type Options = {
  viewingCard: StudyCard | null;
  setViewingCard: Dispatch<SetStateAction<StudyCard | null>>;
  pendingMotionKey: string | null;
};

export function useShelfCardTransition({
  viewingCard,
  setViewingCard,
  pendingMotionKey
}: Options) {
  const [phase, setPhase] = useState<ShelfCardTransitionPhase>("idle");
  const [motion, setMotion] = useState<ShelfCardMotion | null>(null);
  const [pendingMotionReadyKey, setPendingMotionReadyKey] = useState<string | null>(null);
  const dockRef = useRef<HTMLDivElement | null>(null);
  const cardWindowRef = useRef<DraggableCardWindowHandle | null>(null);
  const originRef = useRef<DOMRectReadOnly | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const viewingCardId = viewingCard?.id ?? null;

  function openCard(
    nextCard: StudyCard,
    origin: DOMRectReadOnly,
    trigger?: HTMLButtonElement
  ) {
    originRef.current = origin;
    triggerRef.current = trigger
      ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    flushSync(() => {
      setPendingMotionReadyKey(null);
      setMotion(null);
      setPhase("preparing");
      setViewingCard(nextCard);
    });
  }

  function returnFallback() {
    const candidates = [
      document.querySelector<HTMLElement>('.historyWorkspaceNav[aria-label="展开会话栏"]'),
      document.querySelector<HTMLElement>('.primaryNavButton[aria-current="page"]')
    ];
    return candidates.find((candidate) => canReturnToElement(candidate)) ?? null;
  }

  function restoreFocus() {
    window.requestAnimationFrame(() => {
      const trigger = canReturnToElement(triggerRef.current)
        ? triggerRef.current
        : returnFallback();
      trigger?.focus({ preventScroll: true });
      triggerRef.current = null;
    });
  }

  function closeCard() {
    if (!viewingCard || !dockRef.current) {
      setViewingCard(null);
      restoreFocus();
      return;
    }
    const requestedSource = triggerRef.current;
    if (!canAnimateToElement(requestedSource)) {
      setPhase("closingFallback");
      return;
    }
    const origin = requestedSource.getBoundingClientRect();
    const target = dockRef.current.getBoundingClientRect();
    const offset = cardWindowRef.current?.consumeOffsetAndReset() ?? { x: 0, y: 0 };
    flushSync(() => {
      setMotion({
        x: origin.left - target.left,
        y: origin.top - target.top,
        scaleX: origin.width / target.width,
        scaleY: origin.height / target.height,
        startX: offset.x,
        startY: offset.y
      });
      setPhase("closing");
    });
  }

  function handleAnimationEnd(archived: boolean, animationName: string) {
    if (!archived) {
      if (
        pendingMotionKey
        && (animationName === "activeCardDockEnter"
          || animationName === "reducedCardDockEnter")
      ) {
        setPendingMotionReadyKey(pendingMotionKey);
      }
      return;
    }
    if (phase === "opening" && animationName === "shelfCardOpen") {
      setPhase("open");
      return;
    }
    const finishedClose = (phase === "closing" && animationName === "shelfCardClose")
      || (phase === "closingFallback" && animationName === "shelfCardFadeClose");
    if (finishedClose) {
      flushSync(() => setViewingCard(null));
      restoreFocus();
    }
  }

  useLayoutEffect(() => {
    if (phase !== "preparing" || !viewingCard) return;
    const origin = originRef.current;
    const target = dockRef.current?.getBoundingClientRect();
    if (!origin || !target) return;
    setMotion({
      x: origin.left - target.left,
      y: origin.top - target.top,
      scaleX: origin.width / target.width,
      scaleY: origin.height / target.height
    });
    setPhase("opening");
  }, [phase, viewingCard]);

  useEffect(() => {
    if (viewingCard) return;
    originRef.current = null;
    setMotion(null);
    setPhase("idle");
  }, [viewingCard]);

  useEffect(() => {
    if (!viewingCardId || phase !== "open") return;
    const frameId = window.requestAnimationFrame(() => cardWindowRef.current?.focusHandle());
    return () => window.cancelAnimationFrame(frameId);
  }, [phase, viewingCardId]);

  useEffect(() => {
    if (pendingMotionKey === null) setPendingMotionReadyKey(null);
  }, [pendingMotionKey]);

  return {
    cardWindowRef,
    closeCard,
    dockRef,
    handleAnimationEnd,
    motion,
    openCard,
    pendingMotionReadyKey,
    phase
  };
}
