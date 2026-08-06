"use client";

import { Check, Loader2, Plus, ScanLine, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { DetectedProblemRegion, ExamPaper, ProblemBoundingBox } from "../lib/api";

export type PaperSelection =
  | { mode: "existing"; paperId: string }
  | { mode: "new"; name: string };

type Props = {
  imageUrl: string;
  initialRegions: DetectedProblemRegion[];
  papers?: ExamPaper[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: (regions: DetectedProblemRegion[], paper: PaperSelection) => void;
  onRegionsChange?: (regions: DetectedProblemRegion[]) => void;
};

type ResizeDirection = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

type DragState = {
  id: string;
  direction: ResizeDirection;
  startX: number;
  startY: number;
  startBox: ProblemBoundingBox;
};

type DrawState = {
  startX: number;
  startY: number;
};

const MIN_SIZE = 0.025;
const MAX_REGIONS = 20;
const HANDLE_DIRECTIONS: Exclude<ResizeDirection, "move">[] = [
  "n", "s", "e", "w", "ne", "nw", "se", "sw"
];

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

export function boxFromPoints(
  startX: number,
  startY: number,
  endX: number,
  endY: number
): ProblemBoundingBox {
  const left = clamp(Math.min(startX, endX), 0, 1);
  const top = clamp(Math.min(startY, endY), 0, 1);
  const right = clamp(Math.max(startX, endX), 0, 1);
  const bottom = clamp(Math.max(startY, endY), 0, 1);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function resizeBox(
  start: ProblemBoundingBox,
  direction: ResizeDirection,
  dx: number,
  dy: number
): ProblemBoundingBox {
  if (direction === "move") {
    return {
      ...start,
      x: clamp(start.x + dx, 0, 1 - start.width),
      y: clamp(start.y + dy, 0, 1 - start.height)
    };
  }

  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;
  if (direction.includes("w")) left = clamp(start.x + dx, 0, right - MIN_SIZE);
  if (direction.includes("e")) right = clamp(right + dx, left + MIN_SIZE, 1);
  if (direction.includes("n")) top = clamp(start.y + dy, 0, bottom - MIN_SIZE);
  if (direction.includes("s")) bottom = clamp(bottom + dy, top + MIN_SIZE, 1);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function ProblemImageSelector({
  imageUrl,
  initialRegions,
  papers = [],
  busy,
  onCancel,
  onConfirm,
  onRegionsChange
}: Props) {
  const [regions, setRegions] = useState(initialRegions);
  const [selectedId, setSelectedId] = useState(initialRegions[0]?.id ?? "");
  const [addingRegion, setAddingRegion] = useState(false);
  const [draftBox, setDraftBox] = useState<ProblemBoundingBox | null>(null);
  const [paperMode, setPaperMode] = useState<"existing" | "new">(papers.length ? "existing" : "new");
  const [paperId, setPaperId] = useState(papers[0]?.id ?? "");
  const [newPaperName, setNewPaperName] = useState("");
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const drawRef = useRef<DrawState | null>(null);
  const manualRegionSequenceRef = useRef(1);
  const paperReady = paperMode === "existing" ? Boolean(paperId) : Boolean(newPaperName.trim());
  const onRegionsChangeRef = useRef(onRegionsChange);

  useEffect(() => {
    if (paperMode === "existing" && !paperId && papers[0]) setPaperId(papers[0].id);
  }, [paperId, paperMode, papers]);

  useEffect(() => {
    onRegionsChangeRef.current = onRegionsChange;
  }, [onRegionsChange]);

  useEffect(() => {
    onRegionsChangeRef.current?.(regions);
  }, [regions]);

  function removeRegion(id: string) {
    if (busy) return;
    setRegions((current) => {
      const next = current.filter((region) => region.id !== id);
      if (selectedId === id) setSelectedId(next[0]?.id ?? "");
      return next;
    });
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && addingRegion && !busy) {
        setAddingRegion(false);
        setDraftBox(null);
        drawRef.current = null;
        return;
      }
      if (event.key === "Escape" && !busy) onCancel();
      if ((event.key === "Delete" || event.key === "Backspace") && selectedId && !busy) {
        event.preventDefault();
        removeRegion(selectedId);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  function beginDrag(
    event: ReactPointerEvent<HTMLElement>,
    region: DetectedProblemRegion,
    direction: ResizeDirection
  ) {
    if (busy || addingRegion) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedId(region.id);
    dragRef.current = {
      id: region.id,
      direction,
      startX: event.clientX,
      startY: event.clientY,
      startBox: region.bbox
    };
  }

  function continueDrag(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    const canvas = canvasRef.current;
    if (!drag || !canvas) return;
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const nextBox = resizeBox(
      drag.startBox,
      drag.direction,
      (event.clientX - drag.startX) / rect.width,
      (event.clientY - drag.startY) / rect.height
    );
    setRegions((current) => current.map((region) => (
      region.id === drag.id ? { ...region, bbox: nextBox } : region
    )));
  }

  function endDrag(event: ReactPointerEvent<HTMLElement>) {
    if (dragRef.current) event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
  }

  function pointOnCanvas(event: ReactPointerEvent<HTMLElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((event.clientY - rect.top) / rect.height, 0, 1)
    };
  }

  function beginDraw(event: ReactPointerEvent<HTMLDivElement>) {
    if (!addingRegion || busy || event.button !== 0) return;
    const point = pointOnCanvas(event);
    if (!point) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drawRef.current = { startX: point.x, startY: point.y };
    setSelectedId("");
    setDraftBox(boxFromPoints(point.x, point.y, point.x, point.y));
  }

  function continueDraw(event: ReactPointerEvent<HTMLDivElement>) {
    const draw = drawRef.current;
    if (!draw) return;
    const point = pointOnCanvas(event);
    if (!point) return;
    event.preventDefault();
    setDraftBox(boxFromPoints(draw.startX, draw.startY, point.x, point.y));
  }

  function finishDraw(event: ReactPointerEvent<HTMLDivElement>) {
    const draw = drawRef.current;
    const point = pointOnCanvas(event);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    drawRef.current = null;
    setDraftBox(null);
    if (!draw || !point) return;

    const bbox = boxFromPoints(draw.startX, draw.startY, point.x, point.y);
    if (bbox.width < MIN_SIZE || bbox.height < MIN_SIZE || regions.length >= MAX_REGIONS) return;
    const sequence = manualRegionSequenceRef.current++;
    const region: DetectedProblemRegion = {
      id: `manual-problem-${Date.now()}-${sequence}`,
      label: `新增题目 ${sequence}`,
      bbox
    };
    setRegions((current) => [...current, region]);
    setSelectedId(region.id);
    if (regions.length + 1 >= MAX_REGIONS) setAddingRegion(false);
  }

  function cancelDraw(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    drawRef.current = null;
    setDraftBox(null);
  }

  function toggleAddingRegion() {
    if (busy) return;
    setAddingRegion((current) => !current);
    setDraftBox(null);
    drawRef.current = null;
  }

  return (
    <div className="modalBackdrop problemSelectorBackdrop" role="dialog" aria-modal="true" aria-labelledby="problem-selector-title">
      <section className="problemSelectorDialog">
        <header className="problemSelectorHeader">
          <div>
            <span className="problemSelectorKicker"><ScanLine size={15} /> 题目区域检测</span>
            <h2 id="problem-selector-title">确认要创建的题目</h2>
            <p>
              {addingRegion
                ? "在图片上按住并拖动可连续新增题目框；完成后点击“结束新增”。"
                : "可新增题目框；已有框支持平移、缩放，选中后按 Delete 删除。"}
            </p>
          </div>
          <div className="paperAssignment paperAssignmentHeader" aria-labelledby="paper-assignment-label">
            <div className="paperAssignmentTitle" id="paper-assignment-label">所属试卷</div>
            <div className="paperAssignmentControls">
              <select
                value={paperMode}
                onChange={(event) => setPaperMode(event.target.value as "existing" | "new")}
                disabled={busy}
                aria-label="试卷选择方式"
              >
                {papers.length ? <option value="existing">选择已有试卷</option> : null}
                <option value="new">新建试卷</option>
              </select>
              {paperMode === "existing" ? (
                <select
                  value={paperId}
                  onChange={(event) => setPaperId(event.target.value)}
                  disabled={busy}
                  aria-label="选择已有试卷"
                >
                  {papers.map((paper) => <option key={paper.id} value={paper.id}>{paper.name}</option>)}
                </select>
              ) : (
                <input
                  value={newPaperName}
                  onChange={(event) => setNewPaperName(event.target.value)}
                  maxLength={80}
                  disabled={busy}
                  placeholder="例如：八年级期中模拟卷"
                  aria-label="新试卷名称"
                />
              )}
            </div>
          </div>
          <button type="button" className="iconButton" onClick={onCancel} disabled={busy} aria-label="关闭">
            <X size={18} />
          </button>
        </header>

        <div className="problemSelectorWorkspace">
          <div
            className={`problemSelectorCanvas ${addingRegion ? "adding" : ""}`}
            ref={canvasRef}
            onPointerDown={beginDraw}
            onPointerMove={continueDraw}
            onPointerUp={finishDraw}
            onPointerCancel={cancelDraw}
          >
            <img src={imageUrl} alt="待框选的数学题图片" draggable={false} />
            {regions.map((region, index) => {
              const selected = selectedId === region.id;
              return (
                <div
                  key={region.id}
                  className={`problemRegion ${selected ? "selected" : ""}`}
                  style={{
                    left: `${region.bbox.x * 100}%`,
                    top: `${region.bbox.y * 100}%`,
                    width: `${region.bbox.width * 100}%`,
                    height: `${region.bbox.height * 100}%`
                  }}
                  onPointerDown={(event) => beginDrag(event, region, "move")}
                  onPointerMove={continueDrag}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                >
                  <span className="problemRegionNumber">{index + 1}</span>
                  <button
                    type="button"
                    className="problemRegionDelete"
                    aria-label={`删除${region.label}`}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      removeRegion(region.id);
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                  {HANDLE_DIRECTIONS.map((direction) => (
                    <span
                      key={direction}
                      className={`problemResizeHandle handle-${direction}`}
                      onPointerDown={(event) => beginDrag(event, region, direction)}
                      onPointerMove={continueDrag}
                      onPointerUp={endDrag}
                      onPointerCancel={endDrag}
                    />
                  ))}
                </div>
              );
            })}
            {draftBox ? (
              <div
                className="problemRegion problemRegionDraft"
                aria-hidden="true"
                style={{
                  left: `${draftBox.x * 100}%`,
                  top: `${draftBox.y * 100}%`,
                  width: `${draftBox.width * 100}%`,
                  height: `${draftBox.height * 100}%`
                }}
              />
            ) : null}
          </div>
        </div>

        <footer className="problemSelectorFooter">
          <div className="problemSelectorTools">
            <div className={regions.length ? "problemCount" : "problemCount empty"}>
              {regions.length ? `将创建 ${regions.length} 个独立答疑` : "请新增至少一个题目框"}
            </div>
            <button
              type="button"
              className={`secondaryButton problemSelectorAddButton ${addingRegion ? "active" : ""}`}
              onClick={toggleAddingRegion}
              disabled={busy || (!addingRegion && regions.length >= MAX_REGIONS)}
              aria-pressed={addingRegion}
            >
              {addingRegion ? <Check size={15} /> : <Plus size={15} />}
              {addingRegion ? "结束新增" : "新增题目框"}
            </button>
          </div>
          <div className="dialogActions">
            <button type="button" className="secondaryButton" onClick={onCancel} disabled={busy}>取消</button>
            <button
              type="button"
              className="primaryButton"
              onClick={() => onConfirm(
                regions,
                paperMode === "existing"
                  ? { mode: "existing", paperId }
                  : { mode: "new", name: newPaperName.trim() }
              )}
              disabled={busy || regions.length === 0 || !paperReady}
            >
              {busy ? <Loader2 size={16} className="spin" /> : <Check size={16} />}
              确认并创建 {regions.length || 0} 个答疑
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
