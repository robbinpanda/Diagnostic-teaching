"use client";

import {
  BookOpen,
  CircleAlert,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  Lightbulb,
  Link2,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Route,
  Save,
  Target,
  Trash2,
  X
} from "lucide-react";
import { useEffect, useId, useState, type CSSProperties } from "react";
import type { CardFolder, KnowledgeCardContent, StudyCard } from "../lib/api";
import { cardThemeProperties } from "../lib/card-theme";
import { defaultFolderForCard } from "../lib/card-folders";
import { FolderLocationSelect } from "./FolderLocationSelect";
import { MathText } from "./MathText";

type Props = {
  card: StudyCard | null;
  folders?: CardFolder[];
  onSave?: (card: StudyCard, folderId?: string) => void;
  onCreatePaperFolder?: (name: string) => Promise<string | null>;
  onDiscard?: (card: StudyCard) => void;
  onClose?: () => void;
  busy?: boolean;
  editable?: boolean;
  displayMode?: "inline" | "viewer";
  appearance?: "default" | "flashcard";
  themeVariant?: number;
  libraryView?: boolean;
  autoCollapsed?: boolean;
  forceExpanded?: boolean;
  onExpandCollapsed?: () => void;
};

function TextList({ items }: { items: string[] }) {
  if (items.length === 0) return <p className="cardEmptyLine">本卡没有额外需要提醒的坑点。</p>;
  return (
    <ul className="cardTextList">
      {items.map((item, index) => (
        <li key={`${index}-${item}`}><MathText text={item} /></li>
      ))}
    </ul>
  );
}

function cloneKnowledgeContent(content: KnowledgeCardContent): KnowledgeCardContent {
  return {
    ...content,
    derivation_steps: content.derivation_steps.map((step) => ({ ...step })),
    when_to_use: [...content.when_to_use],
    common_mistakes: [...content.common_mistakes]
  };
}

function cleanKnowledgeContent(content: KnowledgeCardContent) {
  const cleaned: KnowledgeCardContent = {
    ...content,
    title: content.title.trim(),
    knowledge_point: content.knowledge_point.trim(),
    core_idea: content.core_idea.trim(),
    derivation_steps: content.derivation_steps
      .map((step) => ({ title: step.title.trim(), content: step.content.trim() }))
      .filter((step) => step.title || step.content),
    when_to_use: content.when_to_use.map((item) => item.trim()).filter(Boolean),
    common_mistakes: content.common_mistakes.map((item) => item.trim()).filter(Boolean),
    connection_to_problem: content.connection_to_problem.trim()
  };
  if (!cleaned.title) return { error: "请保留一个卡片标题。", content: cleaned };
  if (!cleaned.knowledge_point) return { error: "请填写本卡知识点。", content: cleaned };
  if (!cleaned.core_idea) return { error: "请填写核心原理。", content: cleaned };
  if (cleaned.derivation_steps.length === 0) return { error: "请至少保留一个推导步骤。", content: cleaned };
  if (cleaned.derivation_steps.some((step) => !step.title || !step.content)) {
    return { error: "每个推导步骤都需要标题和内容。", content: cleaned };
  }
  if (cleaned.when_to_use.length === 0) return { error: "请至少保留一个适用场景。", content: cleaned };
  if (!cleaned.connection_to_problem) return { error: "请说明知识点与当前题目的联系。", content: cleaned };
  return { error: "", content: cleaned };
}

type EditableListProps = {
  label: string;
  items: string[];
  addLabel: string;
  onChange: (items: string[]) => void;
};

function EditableList({ label, items, addLabel, onChange }: EditableListProps) {
  return (
    <section className="cardEditorSection">
      <div className="cardEditorSectionHeader">
        <h3>{label}</h3>
        <button type="button" onClick={() => onChange([...items, ""])}>
          <Plus size={14} />
          {addLabel}
        </button>
      </div>
      <div className="cardEditorList">
        {items.length === 0 && <p className="cardEmptyLine">暂无内容，可以点击右上角添加。</p>}
        {items.map((item, index) => (
          <div className="cardEditorListRow" key={index}>
            <textarea
              value={item}
              onChange={(event) => onChange(items.map((value, itemIndex) => (
                itemIndex === index ? event.target.value : value
              )))}
              aria-label={`${label} ${index + 1}`}
              rows={2}
            />
            <button
              className="cardEditorRemoveButton"
              type="button"
              onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}
              aria-label={`删除${label} ${index + 1}`}
              title="删除这一项"
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function KnowledgeCardEditor({
  content,
  onChange
}: {
  content: KnowledgeCardContent;
  onChange: (content: KnowledgeCardContent) => void;
}) {
  function update(patch: Partial<KnowledgeCardContent>) {
    onChange({ ...content, ...patch });
  }

  return (
    <div className="studyCardBody studyCardEditor">
      <label className="cardEditorField cardEditorTitleField">
        <span>卡片标题</span>
        <input value={content.title} onChange={(event) => update({ title: event.target.value })} />
      </label>
      <label className="cardEditorField">
        <span>本卡知识点</span>
        <textarea
          value={content.knowledge_point}
          onChange={(event) => update({ knowledge_point: event.target.value })}
          rows={2}
        />
      </label>
      <label className="cardEditorField">
        <span>核心原理</span>
        <textarea value={content.core_idea} onChange={(event) => update({ core_idea: event.target.value })} rows={4} />
      </label>
      <section className="cardEditorSection">
        <div className="cardEditorSectionHeader">
          <h3>原理怎么推出</h3>
          <button
            type="button"
            onClick={() => update({ derivation_steps: [...content.derivation_steps, { title: "", content: "" }] })}
          >
            <Plus size={14} />
            添加步骤
          </button>
        </div>
        <div className="cardEditorList">
          {content.derivation_steps.length === 0 && <p className="cardEmptyLine">请至少添加一个推导步骤。</p>}
          {content.derivation_steps.map((step, index) => (
            <div className="cardEditorStep" key={index}>
              <div className="cardEditorStepHeader">
                <strong>步骤 {index + 1}</strong>
                <button
                  className="cardEditorRemoveButton"
                  type="button"
                  onClick={() => update({
                    derivation_steps: content.derivation_steps.filter((_, stepIndex) => stepIndex !== index)
                  })}
                  aria-label={`删除推导步骤 ${index + 1}`}
                  title="删除这一步"
                >
                  <Trash2 size={15} />
                </button>
              </div>
              <input
                value={step.title}
                onChange={(event) => update({
                  derivation_steps: content.derivation_steps.map((item, stepIndex) => (
                    stepIndex === index ? { ...item, title: event.target.value } : item
                  ))
                })}
                aria-label={`推导步骤 ${index + 1} 标题`}
                placeholder="步骤标题"
              />
              <textarea
                value={step.content}
                onChange={(event) => update({
                  derivation_steps: content.derivation_steps.map((item, stepIndex) => (
                    stepIndex === index ? { ...item, content: event.target.value } : item
                  ))
                })}
                aria-label={`推导步骤 ${index + 1} 内容`}
                placeholder="公式与理由"
                rows={3}
              />
            </div>
          ))}
        </div>
      </section>
      <EditableList
        label="什么时候用"
        items={content.when_to_use}
        addLabel="添加场景"
        onChange={(when_to_use) => update({ when_to_use })}
      />
      <EditableList
        label="容易踩的坑"
        items={content.common_mistakes}
        addLabel="添加坑点"
        onChange={(common_mistakes) => update({ common_mistakes })}
      />
      <label className="cardEditorField cardEditorConnectionField">
        <span>回到当前题</span>
        <textarea
          value={content.connection_to_problem}
          onChange={(event) => update({ connection_to_problem: event.target.value })}
          rows={3}
        />
      </label>
    </div>
  );
}

export function StudyCardModal({
  card,
  folders = [],
  onSave,
  onCreatePaperFolder,
  onDiscard,
  onClose,
  busy = false,
  editable = false,
  displayMode = "inline",
  appearance = "default",
  themeVariant,
  libraryView = false,
  autoCollapsed = false,
  forceExpanded = false,
  onExpandCollapsed
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<KnowledgeCardContent | null>(() => (
    card?.content.type === "knowledge_card" ? cloneKnowledgeContent(card.content) : null
  ));
  const [validationError, setValidationError] = useState("");
  const [discardConfirmation, setDiscardConfirmation] = useState(false);
  const [folderId, setFolderId] = useState("");
  const [saveLocationExpanded, setSaveLocationExpanded] = useState(false);
  const saveLocationId = useId();
  const [collapsed, setCollapsed] = useState(
    Boolean(card?.deferred_at) && displayMode === "inline" && appearance !== "flashcard"
  );
  const [showBack, setShowBack] = useState(false);

  useEffect(() => {
    if (!card || !folders.length) return;
    setFolderId((current) => current && folders.some((folder) => folder.id === current)
      ? current
      : card.folder_id || defaultFolderForCard(folders, card));
  }, [card, folders]);

  useEffect(() => {
    if (appearance === "flashcard" || displayMode === "viewer") setCollapsed(false);
    else if (card?.deferred_at) setCollapsed(true);
  }, [appearance, card?.deferred_at, displayMode]);

  useEffect(() => {
    if (autoCollapsed) setCollapsed(true);
  }, [autoCollapsed]);

  useEffect(() => {
    if (forceExpanded) setCollapsed(false);
  }, [forceExpanded]);

  useEffect(() => {
    setShowBack(false);
    setSaveLocationExpanded(false);
  }, [card?.id]);

  if (!card) return null;
  const currentCard = card;
  const isKnowledge = currentCard.content.type === "knowledge_card";
  const flashcard = appearance === "flashcard" && displayMode === "inline";
  const knowledgeContent = currentCard.content.type === "knowledge_card"
    ? (editable && draft ? draft : currentCard.content)
    : null;
  const title = knowledgeContent?.title ?? currentCard.content.title;
  const collapsible = Boolean(currentCard.deferred_at) || autoCollapsed;
  const flashcardStyle = flashcard ? cardThemeProperties(currentCard, themeVariant) as CSSProperties : undefined;

  function handleSave() {
    if (!onSave) return;
    if (isKnowledge && editable && draft) {
      const result = cleanKnowledgeContent(draft);
      if (result.error) {
        setValidationError(result.error);
        setEditing(true);
        return;
      }
      setValidationError("");
      setDraft(result.content);
      setDiscardConfirmation(false);
      onSave({ ...currentCard, content: result.content }, folderId || undefined);
      setSaveLocationExpanded(false);
      if (libraryView) setEditing(false);
      return;
    }
    setDiscardConfirmation(false);
    onSave(currentCard, folderId || undefined);
    setSaveLocationExpanded(false);
  }

  function handleSaveIntent() {
    if (folders.length > 0 && !saveLocationExpanded) {
      setDiscardConfirmation(false);
      setSaveLocationExpanded(true);
      return;
    }
    handleSave();
  }

  function handleDiscard() {
    if (!onDiscard) return;
    if (!discardConfirmation) {
      setDiscardConfirmation(true);
      return;
    }
    onDiscard(currentCard);
  }

  return (
    <article
      className={`${displayMode === "viewer" ? "cardViewerDialog" : "inlineInteraction"} studyCardDialog ${isKnowledge ? "knowledgeCard knowledgeFlashcard" : "problemCard problemFlashcard"}${flashcard ? " flashcardPresentation" : ""}${collapsed ? " collapsed" : ""}`}
      style={flashcardStyle}
      aria-label={title}
      role={displayMode === "viewer" ? "dialog" : undefined}
    >
      <header className="studyCardHeader">
        {flashcard ? <>
          <div className="flashcardHeading">
            <span className="flashcardPin" aria-hidden="true" />
            <h2><MathText text={title} /></h2>
          </div>
          <div className="studyCardHeaderActions flashcardActions">
            {editable && onSave ? (
              <button
                className={`cardEditButton flashcardEditButton ${editing ? "active" : ""}`}
                type="button"
                onClick={() => {
                  setDiscardConfirmation(false);
                  setEditing((value) => !value);
                }}
                disabled={busy}
              >
                <Pencil size={14} />
                {editing ? "预览" : "修改"}
              </button>
            ) : null}
            {onDiscard ? (
              <button
                className="cardDiscardButton"
                type="button"
                onClick={handleDiscard}
                disabled={busy}
                data-confirming={discardConfirmation || undefined}
              >
                {busy ? <Loader2 size={15} className="spin" /> : <Trash2 size={15} />}
                {busy ? "处理中" : discardConfirmation ? "确认舍弃" : "舍弃"}
              </button>
            ) : null}
            {onSave ? (
              <button
                className="cardSaveButton"
                type="button"
                onClick={handleSaveIntent}
                disabled={busy || (saveLocationExpanded && folders.length > 0 && !folderId)}
                aria-expanded={folders.length > 0 ? saveLocationExpanded : undefined}
                aria-controls={folders.length > 0 ? saveLocationId : undefined}
              >
                {busy ? <Loader2 size={15} className="spin" /> : <Save size={15} />}
                {busy
                  ? "处理中"
                  : saveLocationExpanded && folders.length > 0
                    ? libraryView
                      ? (isKnowledge ? "确认保存修改" : "确认保存位置")
                      : isKnowledge
                        ? "确认保存知识卡片"
                        : "确认保存题目卡片"
                  : libraryView
                    ? (isKnowledge ? "保存修改" : "保存位置")
                    : isKnowledge
                      ? "保存为知识卡片"
                      : "保存为题目卡片"}
              </button>
            ) : null}
            {onClose ? (
              <button
                className="cardCloseButton flashcardCloseButton"
                type="button"
                onClick={onClose}
                disabled={busy}
                aria-label="关闭卡片"
                title="关闭卡片"
              >
                <X size={17} strokeWidth={2.2} />
              </button>
            ) : null}
          </div>
        </> : <>
          <div>
            <div className="studyCardKicker">
              {isKnowledge ? <BookOpen size={19} /> : <ClipboardCheck size={19} />}
              {currentCard.deferred_at && !libraryView
                ? (isKnowledge ? "待处理知识卡片" : "待处理题目卡片")
                : libraryView
                ? (isKnowledge ? "卡片库中的知识卡片" : "卡片库中的题目卡片")
                : (isKnowledge ? "对话中的知识卡片" : "对话中的题目卡片")}
            </div>
            <h2><MathText text={title} /></h2>
          </div>
          <div className="studyCardHeaderActions">
            {collapsible && displayMode === "inline" && (
              <button
                className="cardEditButton"
                type="button"
                onClick={() => {
                  if (collapsed && autoCollapsed && onExpandCollapsed) {
                    onExpandCollapsed();
                    setCollapsed(false);
                    return;
                  }
                  setCollapsed((value) => !value);
                }}
                disabled={busy}
                aria-expanded={!collapsed}
                aria-label={collapsed && autoCollapsed ? "回到卡片位置并展开" : undefined}
                title={collapsed && autoCollapsed ? "回到卡片位置并展开" : undefined}
              >
                {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                {collapsed ? "展开卡片" : "收起卡片"}
              </button>
            )}
            {!collapsed && isKnowledge && editable && onSave && (
              <button
                className={`cardEditButton ${editing ? "active" : ""}`}
                type="button"
                onClick={() => {
                  setDiscardConfirmation(false);
                  setEditing((value) => !value);
                }}
                disabled={busy}
              >
                <Pencil size={16} />
                {editing ? "预览卡片" : "修改内容"}
              </button>
            )}
            {!collapsed && !editing && (
              <button
                className="cardFlipButton"
                type="button"
                onClick={() => setShowBack((value) => !value)}
                aria-pressed={showBack}
                title={showBack ? "翻回卡片正面" : "查看卡片背面"}
              >
                <RefreshCw size={15} />
                {showBack ? "查看正面" : "翻到背面"}
              </button>
            )}
            {onClose && (
              <button
                className="cardCloseButton"
                type="button"
                onClick={onClose}
                disabled={busy}
                aria-label="关闭卡片"
                title="关闭卡片"
              >
                <X size={22} strokeWidth={2.2} />
              </button>
            )}
          </div>
        </>}
      </header>

      {!collapsed && <>
      {flashcard && onSave && folders.length > 0 && saveLocationExpanded ? (
        <div className="cardSaveLocation flashcardFolderPlacement" id={saveLocationId}>
          <FolderLocationSelect
            folders={folders}
            value={folderId}
            onChange={setFolderId}
            disabled={busy}
            label={libraryView ? "重新归档到" : "保存到"}
            onCreatePaperFolder={onCreatePaperFolder}
          />
        </div>
      ) : null}
      {isKnowledge && knowledgeContent ? (
        editing && editable ? (
          <KnowledgeCardEditor content={knowledgeContent} onChange={(content) => {
            setDraft(content);
            setValidationError("");
          }} />
        ) : (
          <div className={`studyCardBody cardFace ${showBack ? "cardFaceBack" : "cardFaceFront"}`}>
            {!showBack ? <>
              {flashcard ? (
                <section className="flashcardSummaryPanel">
                  <div className="flashcardSummaryBlock">
                    <span className="flashcardMiniIcon"><Lightbulb size={17} /></span>
                    <div>
                      <span>关键关系</span>
                      <strong><MathText text={knowledgeContent.knowledge_point} /></strong>
                    </div>
                  </div>
                  <div className="flashcardSummaryBlock">
                    <span className="flashcardMiniIcon"><BookOpen size={17} /></span>
                    <div>
                      <span>核心原理</span>
                      <MathText text={knowledgeContent.core_idea} />
                    </div>
                  </div>
                </section>
              ) : <>
                <section className="cardLeadSection">
                  <span>本卡知识点</span>
                  <MathText text={knowledgeContent.knowledge_point} />
                </section>
                <section>
                  <h3>核心原理</h3>
                  <MathText text={knowledgeContent.core_idea} />
                </section>
                <p className="cardFlipHint">点击“翻到背面”查看推导、适用场景和易错点</p>
              </>}
            </> : <>
              <section>
                <h3>{flashcard ? <Route size={15} /> : null}原理怎么推出</h3>
                <ol className="cardStepList">
                  {knowledgeContent.derivation_steps.map((item, index) => (
                    <li key={`${index}-${item.title}`}>
                      <strong><MathText text={item.title} /></strong>
                      <MathText text={item.content} />
                    </li>
                  ))}
                </ol>
              </section>
              <section>
                <h3>{flashcard ? <Target size={15} /> : null}什么时候用</h3>
                <TextList items={knowledgeContent.when_to_use} />
              </section>
              <section>
                <h3>{flashcard ? <CircleAlert size={15} /> : null}容易踩的坑</h3>
                <TextList items={knowledgeContent.common_mistakes} />
              </section>
              <section className="cardConnection">
                <h3>{flashcard ? <Link2 size={15} /> : null}回到当前题</h3>
                <MathText text={knowledgeContent.connection_to_problem} />
              </section>
            </>}
          </div>
        )
      ) : currentCard.content.type === "problem_card" ? (
        <div className={`studyCardBody cardFace ${showBack ? "cardFaceBack" : "cardFaceFront"}`}>
          {!showBack ? <>
            {flashcard ? (
              <section className="flashcardSummaryPanel problemFlashcardSummary">
                <div className="flashcardSummaryBlock">
                  <span className="flashcardMiniIcon"><ClipboardCheck size={17} /></span>
                  <div>
                    <span>题目摘要</span>
                    <strong><MathText text={currentCard.content.problem_summary} /></strong>
                  </div>
                </div>
              </section>
            ) : <>
              <section className="cardLeadSection">
                <span>题目摘要</span>
                <MathText text={currentCard.content.problem_summary} />
              </section>
              <p className="cardFlipHint">先独立想一想，再点击“翻到背面”查看完整解析</p>
            </>}
          </> : <>
            <section>
              <h3>{flashcard ? <Route size={15} /> : null}{flashcard ? "解题思路" : "上帝视角路线"}</h3>
              <MathText text={currentCard.content.solution_overview} />
            </section>
            <section>
              <h3>{flashcard ? <Target size={15} /> : null}{flashcard ? "关键步骤" : "完整解答流程"}</h3>
              <ol className="cardStepList problemStepList">
                {currentCard.content.solution_steps.map((item) => (
                  <li key={`${item.step}-${item.title}`}>
                    <div className="problemStepTitle"><span>{item.step}</span><strong><MathText text={item.title} /></strong></div>
                    <p className="stepReason"><MathText text={item.reasoning} /></p>
                    <div className="stepResult"><MathText text={item.result} /></div>
                  </li>
                ))}
              </ol>
            </section>
            <section>
              <h3>{flashcard ? <Lightbulb size={15} /> : null}如何想到这些步骤</h3>
              <TextList items={currentCard.content.how_to_think} />
            </section>
            <section>
              <h3>{flashcard ? <CircleAlert size={15} /> : null}{flashcard ? "易错提醒" : "需要注意的坑"}</h3>
              <TextList items={currentCard.content.pitfalls} />
            </section>
            <section className="cardFinalAnswer">
              <h3>{flashcard ? <ClipboardCheck size={15} /> : null}最终答案</h3>
              <MathText text={currentCard.content.final_answer} />
            </section>
          </>}
        </div>
      ) : null}

      {flashcard && !editing ? (
        <button
          className="flashcardFlipBar"
          type="button"
          onClick={() => setShowBack((value) => !value)}
          aria-pressed={showBack}
          title={showBack ? "翻回卡片正面" : "查看卡片背面"}
        >
          <RefreshCw size={15} />
          {showBack ? "翻回正面" : isKnowledge ? "翻转查看推导与应用" : "翻转查看解题步骤"}
        </button>
      ) : null}
      {flashcard && validationError ? (
        <span className="flashcardValidationError" role="alert">{validationError}</span>
      ) : null}

      {!flashcard && (onSave || onDiscard) && (
        <footer className="studyCardFooter">
          <div>
            <strong>{libraryView
              ? (isKnowledge ? "修改会直接更新这张已归档知识卡片" : "可以重新选择这张题目卡片的归档试卷")
              : (isKnowledge ? "确认后才会进入知识卡片库" : "确认后才会进入题目卡片库")}</strong>
            <span>{libraryView
              ? "保存修改不会改变当前对话内容。"
              : currentCard.deferred_at
                ? "这是先前暂存的卡片；保存或舍弃只处理卡片，不会重复触发讲解。"
                : (isKnowledge ? "保存或舍弃后，AI 都会接着当前对话继续讲解。" : "保存后，本轮答疑完成。")}</span>
            {validationError && <span className="cardValidationError" role="alert">{validationError}</span>}
          </div>
          {onSave && folders.length > 0 && saveLocationExpanded && (
            <div className="cardSaveLocation" id={saveLocationId}>
              <FolderLocationSelect
                folders={folders}
                value={folderId}
                onChange={setFolderId}
                disabled={busy}
                onCreatePaperFolder={onCreatePaperFolder}
              />
            </div>
          )}
          <div className="studyCardFooterActions">
            {isKnowledge && onDiscard && (
              <button
                className="cardDiscardButton"
                type="button"
                onClick={handleDiscard}
                disabled={busy}
                data-confirming={discardConfirmation || undefined}
              >
                {busy ? <Loader2 size={17} className="spin" /> : <Trash2 size={17} />}
                {busy ? "处理中" : discardConfirmation ? "确认舍弃" : "舍弃"}
              </button>
            )}
            {onSave && (
              <button
                className="cardSaveButton"
                type="button"
                onClick={handleSaveIntent}
                disabled={busy || (saveLocationExpanded && folders.length > 0 && !folderId)}
                aria-expanded={folders.length > 0 ? saveLocationExpanded : undefined}
                aria-controls={folders.length > 0 ? saveLocationId : undefined}
              >
                {busy ? <Loader2 size={17} className="spin" /> : <Save size={17} />}
                {busy
                  ? "处理中"
                  : saveLocationExpanded && folders.length > 0
                    ? libraryView
                      ? "确认保存修改"
                      : isKnowledge
                        ? "确认保存知识卡片"
                        : "确认保存题目卡片"
                  : libraryView
                    ? "保存修改"
                    : isKnowledge
                      ? "保存为知识卡片"
                      : "保存为题目卡片"}
              </button>
            )}
          </div>
        </footer>
      )}
      </>}
    </article>
  );
}
