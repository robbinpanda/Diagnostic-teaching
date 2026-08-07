"use client";

import { ArrowLeft, Loader2, Printer, Save } from "lucide-react";

import type { MistakeSetItem } from "../lib/api";
import { MathText } from "./MathText";


export type PrintableMistakeItem = Pick<
  MistakeSetItem,
  "id" | "source_paper_name" | "title" | "problem_text" | "problem_image_data_url" | "position"
>;

type DocumentProps = {
  name: string;
  items: PrintableMistakeItem[];
  className: string;
};


function MistakeSetDocument({ name, items, className }: DocumentProps) {
  return (
    <section aria-label={`${name} PDF 打印稿`} className={className}>
      <style>{"@media print { @page { size: A4 portrait; margin: 13mm; background: #ffffff; } }"}</style>
      <header className="knowledgeCardPrintHeader mistakeSetDocumentHeader">
        <div>
          <span>错题集</span>
          <h1>{name}</h1>
        </div>
        <p>{items.length} 道题</p>
      </header>
      <div className="mistakeSetDocumentQuestions">
        {items.map((item, index) => (
          <article className="mistakeSetDocumentQuestion" key={item.id}>
            <header>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div>
                <small>{item.source_paper_name || "未分类题目"}</small>
                <h2><MathText text={item.title || item.problem_text || "未命名题目"} /></h2>
              </div>
            </header>
            {item.problem_text && item.problem_text.trim() !== item.title.trim() ? (
              <div className="mistakeSetQuestionText"><MathText text={item.problem_text} /></div>
            ) : null}
            {item.problem_image_data_url ? (
              <img alt={`第 ${index + 1} 题题图`} src={item.problem_image_data_url} />
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}


type ViewProps = {
  name: string;
  items: PrintableMistakeItem[];
  editableName?: boolean;
  busy?: boolean;
  onNameChange?: (name: string) => void;
  onBack: () => void;
  onSaveOnly?: () => void;
  onSaveAndPrint?: () => void;
  onPrint?: () => void;
};


export function MistakeSetPrintView({
  name,
  items,
  editableName = false,
  busy = false,
  onNameChange,
  onBack,
  onSaveOnly,
  onSaveAndPrint,
  onPrint
}: ViewProps) {
  const validName = name.trim().length > 0 && name.trim().length <= 80;

  return (
    <section className="mistakeSetPreview" aria-label="错题集打印预览">
      <header className="mistakeSetPreviewToolbar">
        <button className="historyWorkspaceBack" type="button" onClick={onBack} aria-label="返回错题集列表或题目选择">
          <ArrowLeft size={18} />
        </button>
        <div className="mistakeSetPreviewTitle">
          {editableName ? (
            <label>
              <span>错题集名称</span>
              <input
                value={name}
                maxLength={80}
                onChange={(event) => onNameChange?.(event.target.value)}
                disabled={busy}
              />
            </label>
          ) : <h1>{name}</h1>}
          <p>{items.length} 道题 · A4 纵向打印预览</p>
        </div>
        <div className="mistakeSetPreviewActions">
          {onSaveOnly ? (
            <button className="secondaryButton" type="button" onClick={onSaveOnly} disabled={busy || !validName}>
              {busy ? <Loader2 className="spin" size={17} /> : <Save size={17} />}
              仅保存
            </button>
          ) : null}
          {onSaveAndPrint ? (
            <button className="primaryButton" type="button" onClick={onSaveAndPrint} disabled={busy || !validName}>
              {busy ? <Loader2 className="spin" size={17} /> : <Printer size={17} />}
              保存并打印
            </button>
          ) : null}
          {onPrint ? (
            <button className="primaryButton" type="button" onClick={onPrint} disabled={busy}>
              <Printer size={17} />打印
            </button>
          ) : null}
        </div>
      </header>
      {!validName ? <p className="mistakeSetNameError" role="alert">名称需要包含 1–80 个字符。</p> : null}
      <div className="mistakeSetPreviewCanvas">
        <MistakeSetDocument
          name={name.trim() || "未命名错题集"}
          items={items}
          className="mistakeSetPreviewSheet"
        />
      </div>
    </section>
  );
}


export function MistakeSetPrintDocument({ name, items }: Omit<DocumentProps, "className">) {
  return (
    <MistakeSetDocument
      name={name}
      items={items}
      className="knowledgeCardPrintRoot mistakeSetPrintRoot"
    />
  );
}
