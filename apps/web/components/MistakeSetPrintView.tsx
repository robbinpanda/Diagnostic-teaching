"use client";

import { ArrowLeft, EyeOff, Loader2, Printer, Save } from "lucide-react";

import type { MistakeSetItem, ProblemCardContent } from "../lib/api";
import { StudyCardPrintCard } from "./StudyCardPrintCard";

export type PrintableMistakeItem = Pick<
  MistakeSetItem,
  "id" | "source_paper_name" | "title" | "problem_text" | "problem_image_data_url" | "problem_card" | "position"
>;

type DocumentProps = {
  name: string;
  items: PrintableMistakeItem[];
  practiceMode: boolean;
  className: string;
};

function fallbackProblemCard(item: PrintableMistakeItem): ProblemCardContent {
  const summary = item.problem_text.trim() || item.title.trim() || "未命名题目";
  return {
    type: "problem_card",
    title: item.title.trim() || summary,
    problem_summary: summary,
    solution_overview: "",
    solution_steps: [],
    pitfalls: [],
    how_to_think: [],
    final_answer: ""
  };
}

function MistakeSetDocument({ name, items, practiceMode, className }: DocumentProps) {
  return (
    <section aria-label={`${name} PDF 打印稿`} className={`${className} printLayout-double`}>
      <style>{"@media print { @page { size: A4 portrait; margin: 9mm; background: #ffffff; } }"}</style>
      <header className="knowledgeCardPrintHeader mistakeSetDocumentHeader">
        <div><span>题目卡片集</span><h1>{name}</h1></div>
        <p>{items.length} 张 · 固定双列{practiceMode ? " · 练习模式" : ""}</p>
      </header>
      <div className="knowledgeCardPrintColumns mistakeSetDocumentQuestions" style={{ columnCount: 2 }}>
        {items.map((item, index) => (
          <StudyCardPrintCard
            content={item.problem_card || fallbackProblemCard(item)}
            incomplete={!item.problem_card}
            index={index}
            key={item.id}
            label={`${item.source_paper_name || "未分类题目"} · 题目卡片`}
            practiceMode={practiceMode}
          />
        ))}
      </div>
    </section>
  );
}

type ViewProps = {
  name: string;
  items: PrintableMistakeItem[];
  practiceMode: boolean;
  editableName?: boolean;
  busy?: boolean;
  onNameChange?: (name: string) => void;
  onPracticeModeChange: (enabled: boolean) => void;
  onBack: () => void;
  onSaveOnly?: () => void;
  onSaveAndPrint?: () => void;
  onPrint?: () => void;
};

export function MistakeSetPrintView({
  name,
  items,
  practiceMode,
  editableName = false,
  busy = false,
  onNameChange,
  onPracticeModeChange,
  onBack,
  onSaveOnly,
  onSaveAndPrint,
  onPrint
}: ViewProps) {
  const validName = name.trim().length > 0 && name.trim().length <= 80;

  return (
    <section className="mistakeSetPreview" aria-label="题目卡片打印预览">
      <header className="mistakeSetPreviewToolbar">
        <button className="historyWorkspaceBack" type="button" onClick={onBack} aria-label="返回错题集列表或题目选择"><ArrowLeft size={18} /></button>
        <div className="mistakeSetPreviewTitle">
          {editableName ? (
            <label><span>错题集名称</span><input value={name} maxLength={80} onChange={(event) => onNameChange?.(event.target.value)} disabled={busy} /></label>
          ) : <h1>{name}</h1>}
          <p>{items.length} 张题目卡片 · A4 纵向固定双列</p>
        </div>
        <div className="mistakeSetPreviewActions">
          <label className={`mistakePracticeToggle${practiceMode ? " active" : ""}`}>
            <input type="checkbox" checked={practiceMode} onChange={(event) => onPracticeModeChange(event.target.checked)} disabled={busy} />
            <EyeOff size={16} />只看题目摘要
          </label>
          {onSaveOnly ? <button className="secondaryButton" type="button" onClick={onSaveOnly} disabled={busy || !validName}>{busy ? <Loader2 className="spin" size={17} /> : <Save size={17} />}仅保存</button> : null}
          {onSaveAndPrint ? <button className="primaryButton" type="button" onClick={onSaveAndPrint} disabled={busy || !validName}>{busy ? <Loader2 className="spin" size={17} /> : <Printer size={17} />}保存并打印</button> : null}
          {onPrint ? <button className="primaryButton" type="button" onClick={onPrint} disabled={busy}><Printer size={17} />打印</button> : null}
        </div>
      </header>
      {!validName ? <p className="mistakeSetNameError" role="alert">名称需要包含 1–80 个字符。</p> : null}
      <div className="mistakeSetPreviewCanvas">
        <MistakeSetDocument name={name.trim() || "未命名错题集"} items={items} practiceMode={practiceMode} className="mistakeSetPreviewSheet" />
      </div>
    </section>
  );
}

export function MistakeSetPrintDocument({ name, items, practiceMode }: Omit<DocumentProps, "className">) {
  return <MistakeSetDocument name={name} items={items} practiceMode={practiceMode} className="knowledgeCardPrintRoot mistakeSetPrintRoot" />;
}
