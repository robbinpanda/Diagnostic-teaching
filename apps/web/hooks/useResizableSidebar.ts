"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import {
  DEFAULT_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  clampSidebarWidth,
  getSidebarWidthBounds,
  readStoredSidebarWidth,
  writeStoredSidebarWidth
} from "../lib/sidebar-layout";

export function useResizableSidebar() {
  const [leftOpen, setLeftOpen] = useState(true);
  const [responsiveReady, setResponsiveReady] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [sidebarMaxWidth, setSidebarMaxWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const appShellRef = useRef<HTMLElement | null>(null);
  const sidebarWidthRef = useRef(DEFAULT_SIDEBAR_WIDTH);
  const sidebarPreferredWidthRef = useRef(DEFAULT_SIDEBAR_WIDTH);
  const resizePointerIdRef = useRef<number | null>(null);

  useEffect(() => {
    const compact = window.matchMedia("(max-width: 1319px)");
    const syncCompactState = (matches: boolean) => {
      if (matches) setLeftOpen(false);
      setResponsiveReady(true);
    };
    syncCompactState(compact.matches);
    const onChange = (event: MediaQueryListEvent) => syncCompactState(event.matches);
    compact.addEventListener("change", onChange);
    return () => compact.removeEventListener("change", onChange);
  }, []);

  useLayoutEffect(() => {
    const shell = appShellRef.current;
    if (!shell) return;

    const syncSidebarBounds = () => {
      const bounds = getSidebarWidthBounds(shell.clientWidth);
      const next = clampSidebarWidth(sidebarPreferredWidthRef.current, shell.clientWidth);
      setSidebarMaxWidth(bounds.max);
      sidebarWidthRef.current = next;
      setSidebarWidth(next);
    };

    const storedWidth = readStoredSidebarWidth(() => window.localStorage);
    const initialWidth = clampSidebarWidth(storedWidth, shell.clientWidth);
    sidebarPreferredWidthRef.current = storedWidth;
    sidebarWidthRef.current = initialWidth;
    setSidebarWidth(initialWidth);
    setSidebarMaxWidth(getSidebarWidthBounds(shell.clientWidth).max);
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", syncSidebarBounds);
      return () => window.removeEventListener("resize", syncSidebarBounds);
    }

    const resizeObserver = new ResizeObserver(syncSidebarBounds);
    resizeObserver.observe(shell);
    return () => resizeObserver.disconnect();
  }, []);

  function setClampedWidth(width: number) {
    const shell = appShellRef.current;
    if (!shell) return sidebarWidthRef.current;
    const bounds = getSidebarWidthBounds(shell.clientWidth);
    const next = clampSidebarWidth(width, shell.clientWidth);
    sidebarPreferredWidthRef.current = next;
    sidebarWidthRef.current = next;
    setSidebarMaxWidth(bounds.max);
    setSidebarWidth(next);
    return next;
  }

  function persistWidth() {
    writeStoredSidebarWidth(() => window.localStorage, sidebarPreferredWidthRef.current);
  }

  function updateWidthFromPointer(clientX: number) {
    const shell = appShellRef.current;
    if (!shell) return;
    setClampedWidth(clientX - shell.getBoundingClientRect().left);
  }

  function handleResizePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    resizePointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    setSidebarResizing(true);
    updateWidthFromPointer(event.clientX);
    event.preventDefault();
  }

  function handleResizePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (resizePointerIdRef.current !== event.pointerId) return;
    updateWidthFromPointer(event.clientX);
  }

  function finishResize(pointerId: number) {
    if (resizePointerIdRef.current !== pointerId) return;
    resizePointerIdRef.current = null;
    setSidebarResizing(false);
    persistWidth();
  }

  function handleResizePointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    finishResize(event.pointerId);
  }

  function handleResizeKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 48 : 16;
    let nextWidth: number | null = null;
    if (event.key === "ArrowLeft") nextWidth = sidebarWidthRef.current - step;
    if (event.key === "ArrowRight") nextWidth = sidebarWidthRef.current + step;
    if (event.key === "Home") nextWidth = MIN_SIDEBAR_WIDTH;
    if (event.key === "End") nextWidth = sidebarMaxWidth;
    if (nextWidth === null) return;
    event.preventDefault();
    setClampedWidth(nextWidth);
    persistWidth();
  }

  function closeNavigationOnMobile() {
    if (window.matchMedia("(max-width: 760px)").matches) setLeftOpen(false);
  }

  return {
    appShellRef,
    closeNavigationOnMobile,
    finishResize,
    handleResizeKeyDown,
    handleResizePointerDown,
    handleResizePointerEnd,
    handleResizePointerMove,
    leftOpen,
    minSidebarWidth: MIN_SIDEBAR_WIDTH,
    responsiveReady,
    setLeftOpen,
    sidebarMaxWidth,
    sidebarResizing,
    sidebarWidth
  };
}
