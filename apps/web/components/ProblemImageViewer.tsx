"use client";

import { Image as ImageIcon, Minus, Plus, RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";

type Props = {
  imageUrl: string;
  onClose: () => void;
};

type Point = {
  x: number;
  y: number;
};

const MIN_SCALE = 1;
const MAX_SCALE = 5;
const SCALE_STEP = 0.5;

export function clampImageScale(value: number) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}

export function ProblemImageViewer({ imageUrl, onClose }: Props) {
  const [scale, setScale] = useState(MIN_SCALE);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const dragRef = useRef<{ pointerId: number; start: Point; origin: Point } | null>(null);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (event.key === "+" || event.key === "=") zoomBy(SCALE_STEP);
      if (event.key === "-") zoomBy(-SCALE_STEP);
      if (event.key === "0") resetView();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  function zoomBy(delta: number) {
    setScale((current) => {
      const next = clampImageScale(current + delta);
      if (next === MIN_SCALE) setOffset({ x: 0, y: 0 });
      return next;
    });
  }

  function resetView() {
    setScale(MIN_SCALE);
    setOffset({ x: 0, y: 0 });
  }

  function handleWheel(event: ReactWheelEvent<HTMLDivElement>) {
    event.preventDefault();
    zoomBy(event.deltaY < 0 ? SCALE_STEP : -SCALE_STEP);
  }

  function beginDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (scale <= MIN_SCALE) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      origin: offset
    };
  }

  function continueDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    setOffset({
      x: drag.origin.x + event.clientX - drag.start.x,
      y: drag.origin.y + event.clientY - drag.start.y
    });
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
  }

  return (
    <div
      className="problemViewerBackdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="problem-viewer-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="problemViewerDialog">
        <header className="problemViewerHeader">
          <div>
            <strong id="problem-viewer-title"><ImageIcon size={17} /> 题目图片</strong>
            <span>滚轮缩放，放大后拖动查看</span>
          </div>
          <div className="problemViewerControls">
            <button type="button" onClick={() => zoomBy(-SCALE_STEP)} disabled={scale <= MIN_SCALE} aria-label="缩小图片" title="缩小">
              <Minus size={17} />
            </button>
            <span aria-live="polite">{Math.round(scale * 100)}%</span>
            <button type="button" onClick={() => zoomBy(SCALE_STEP)} disabled={scale >= MAX_SCALE} aria-label="放大图片" title="放大">
              <Plus size={17} />
            </button>
            <button type="button" onClick={resetView} disabled={scale === MIN_SCALE && offset.x === 0 && offset.y === 0} aria-label="重置图片视图" title="适应屏幕">
              <RotateCcw size={16} />
            </button>
            <button type="button" onClick={onClose} aria-label="关闭题目图片" title="关闭" autoFocus>
              <X size={18} />
            </button>
          </div>
        </header>
        <div
          className={`problemViewerWorkspace ${scale > MIN_SCALE ? "zoomed" : ""}`}
          onWheel={handleWheel}
          onPointerDown={beginDrag}
          onPointerMove={continueDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <img
            src={imageUrl}
            alt="当前答疑的题目大图"
            draggable={false}
            style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
          />
        </div>
      </section>
    </div>
  );
}
