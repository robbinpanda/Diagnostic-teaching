"use client";

import { ArrowLeft, CheckSquare2, ChevronRight, FileText, Loader2, Printer, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState, type Ref } from "react";

import type { MistakeSet } from "../../lib/api";
import { stableHistoryPaperAccent } from "../../lib/history-view";
import { MistakeSetPrintView } from "../MistakeSetPrintView";
import { MathText } from "../MathText";


export type MistakeSetView =
  | { mode: "overview" }
  | { mode: "detail"; setId: string };

type Props = {
  workspaceRef?: Ref<HTMLElement>;
  view: MistakeSetView;
  mistakeSets: MistakeSet[];
  busy: boolean;
  leftOpen: boolean;
  selectionMode?: boolean;
  selectedSetIds?: string[];
  deleteBusy?: boolean;
  onExpandLeft: () => void;
  onOpenSet: (setId: string) => void;
  onBackToOverview: () => void;
  onPrint: (set: MistakeSet, practiceMode: boolean) => void;
  onToggleSelectionMode?: () => void;
  onToggleSetSelection?: (setId: string) => void;
  onDeleteSelection?: () => void;
};

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "Asia/Shanghai"
});


export function MistakeSetWorkspace({
  workspaceRef,
  view,
  mistakeSets,
  busy,
  leftOpen,
  selectionMode = false,
  selectedSetIds = [],
  deleteBusy = false,
  onExpandLeft,
  onOpenSet,
  onBackToOverview,
  onPrint,
  onToggleSelectionMode = () => undefined,
  onToggleSetSelection = () => undefined,
  onDeleteSelection = () => undefined
}: Props) {
  const [query, setQuery] = useState("");
  const [practiceMode, setPracticeMode] = useState(false);
  const selectedSet = view.mode === "detail"
    ? mistakeSets.find((item) => item.id === view.setId)
    : undefined;
  const visibleSets = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("zh-CN");
    if (!normalized) return mistakeSets;
    return mistakeSets.filter((set) => set.name.toLocaleLowerCase("zh-CN").includes(normalized)
      || set.items.some((item) => item.title.toLocaleLowerCase("zh-CN").includes(normalized)));
  }, [mistakeSets, query]);

  useEffect(() => setPracticeMode(false), [selectedSet?.id]);

  if (view.mode === "detail" && selectedSet) {
    return (
      <section ref={workspaceRef} className="historyWorkspace" aria-label="错题集 PDF 工作区">
        <MistakeSetPrintView
          name={selectedSet.name}
          items={selectedSet.items}
          practiceMode={practiceMode}
          onPracticeModeChange={setPracticeMode}
          onBack={onBackToOverview}
          onPrint={() => onPrint(selectedSet, practiceMode)}
        />
      </section>
    );
  }

  return (
    <section ref={workspaceRef} className="historyWorkspace mistakeSetLibraryWorkspace" aria-label="错题集工作区" aria-busy={busy}>
      <header className="historyWorkspaceHeader">
        {leftOpen ? null : (
          <button className="historyWorkspaceNav" type="button" onClick={onExpandLeft} aria-label="展开会话栏">
            <ChevronRight size={18} />
          </button>
        )}
        {view.mode === "detail" ? (
          <button className="historyWorkspaceBack" type="button" onClick={onBackToOverview} aria-label="返回错题集列表">
            <ArrowLeft size={18} />
          </button>
        ) : null}
        <div className="historyWorkspaceTitle">
          <h1>错题集</h1>
          <p>已保存与打印过的跨卷错题</p>
        </div>
        <div className="historyWorkspaceToolbar">
          <div className="historySelectionActions">
            <button className={`historyWorkspaceAction${selectionMode ? " active" : ""}`} type="button" onClick={onToggleSelectionMode} disabled={mistakeSets.length === 0} aria-pressed={selectionMode}>
              <CheckSquare2 size={16} />{selectionMode ? "退出多选" : "多选"}
            </button>
            <button className="historyWorkspaceAction historyDeleteSelectionAction" type="button" onClick={onDeleteSelection} disabled={selectedSetIds.length === 0 || deleteBusy}>
              {deleteBusy ? <Loader2 className="spin" size={16} /> : <Trash2 size={16} />}
              删除{selectedSetIds.length > 0 ? ` (${selectedSetIds.length})` : ""}
            </button>
          </div>
          <label className="historyWorkspaceSearch">
            <FileText size={17} />
            <span className="srOnly">搜索错题集或题目</span>
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索错题集或题目" />
          </label>
        </div>
      </header>
      <div className="historyWorkspaceBody">
        <div className="historyWorkspaceBodyInner">
          {busy && mistakeSets.length === 0 ? (
            <div className="historyWorkspaceState"><Loader2 className="spin" size={20} /><strong>正在加载错题集</strong></div>
          ) : mistakeSets.length === 0 ? (
            <div className="historyWorkspaceState"><strong>还没有错题集</strong><p>在错题卡片库中多选题目并保存后，会出现在这里。</p></div>
          ) : visibleSets.length === 0 ? (
            <div className="historyWorkspaceState"><strong>没有匹配的错题集</strong><p>换一个名称或题目关键词。</p></div>
          ) : (
            <div className="historyPaperGrid">
              {visibleSets.map((set) => {
                const selected = selectedSetIds.includes(set.id);
                return (
                  <div className="historyPaperCardShell" key={set.id}>
                    <button
                      className="historyPaperCard"
                      type="button"
                      data-accent={stableHistoryPaperAccent(set.id)}
                      onClick={() => onOpenSet(set.id)}
                      aria-label={`打开错题集：${set.name}`}
                    >
                      <span className="historyPaperPreview">
                        <span className="historyPaperTab" aria-hidden="true" />
                        <span className="historyGradeBadge"><Printer size={13} /> PDF 错题集</span>
                        <strong className="historyPaperCoverTitle">{set.name}</strong>
                        <span className="historyPaperPreviewList">
                          {set.items.slice(0, 3).map((item) => (
                            <span className="historyPaperQuestionPreview" key={item.id}><MathText text={item.title} /></span>
                          ))}
                        </span>
                      </span>
                      <span className="historyPaperMeta">
                        <strong>{set.name}</strong>
                        <span>{set.items.length} 道题 · 保存于 {dateFormatter.format(new Date(set.updated_at))}</span>
                      </span>
                    </button>
                    {selectionMode ? (
                      <button className="historyPaperSelect" type="button" onClick={() => onToggleSetSelection(set.id)} aria-pressed={selected} aria-label={`${selected ? "取消选择" : "选择错题集"}：${set.name}`}>
                        <CheckSquare2 size={16} />{selected ? "取消选择" : "选择错题集"}
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
