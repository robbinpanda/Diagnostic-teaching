import { BookOpen, Bot, ChevronDown, ClipboardCheck } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { ChatMessage } from "../../lib/timeline";
import { CheckpointModal } from "../CheckpointModal";
import { MathText } from "../MathText";

const ACTION_LABELS: Record<string, string> = {
  ASK_OPEN_QUESTION: "开放提问",
  ASK_MULTIPLE_CHOICE: "选择检查点",
  EXPLAIN_LOCAL: "局部讲解",
  EXPLAIN_PRINCIPLE: "原理讲解",
  RESPOND_TO_CHECKPOINT: "检查点反馈",
  SUMMARIZE: "总结"
};

type AnchoredInteractionConfig = {
  id: string;
  sourceActionId: string;
  title: string;
  cardType: "knowledge_card" | "problem_card";
  render: (
    autoCollapsed: boolean,
    returnToAnchor: () => void,
    forceExpanded: boolean
  ) => ReactNode;
};

type Props = {
  messages: ChatMessage[];
  messageEndRef: RefObject<HTMLDivElement | null>;
  interaction?: ReactNode;
  anchoredInteractions?: AnchoredInteractionConfig[];
  onOpenImage?: (imageUrl: string) => void;
};

export function anchoredInteractionScrollTop(
  currentScrollTop: number,
  viewportTop: number,
  anchorTop: number
) {
  return Math.max(0, currentScrollTop + anchorTop - viewportTop - 20);
}

export function shouldCollapseAnchoredInteraction(viewportTop: number, cardBottom: number) {
  return cardBottom < viewportTop;
}

function AnchoredInteraction({
  id,
  render,
  forceExpanded,
  onPastChange,
  registerReturn
}: {
  id: string;
  render: AnchoredInteractionConfig["render"];
  forceExpanded: boolean;
  onPastChange: (id: string, past: boolean) => void;
  registerReturn: (id: string, callback: (() => void) | null) => void;
}) {
  const sentinelRef = useRef<HTMLSpanElement | null>(null);
  const cardEndRef = useRef<HTMLSpanElement | null>(null);
  const [scrolledPast, setScrolledPast] = useState(false);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    const cardEnd = cardEndRef.current;
    const viewport = sentinel?.closest(".messageViewport");
    if (!sentinel || !cardEnd || !(viewport instanceof HTMLElement)) return;

    const update = () => {
      const viewportTop = viewport.getBoundingClientRect().top + 10;
      const nextScrolledPast = shouldCollapseAnchoredInteraction(
        viewportTop,
        cardEnd.getBoundingClientRect().top
      );
      setScrolledPast((current) => {
        if (current !== nextScrolledPast) onPastChange(id, nextScrolledPast);
        return nextScrolledPast;
      });
    };
    update();
    viewport.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      viewport.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [id, onPastChange]);

  const returnToAnchor = useCallback(() => {
    const sentinel = sentinelRef.current;
    const viewport = sentinel?.closest(".messageViewport");
    if (sentinel && viewport instanceof HTMLElement) {
      viewport.scrollTo({
        top: anchoredInteractionScrollTop(
          viewport.scrollTop,
          viewport.getBoundingClientRect().top,
          sentinel.getBoundingClientRect().top
        ),
        behavior: "auto"
      });
    } else {
      sentinel?.scrollIntoView({ behavior: "auto", block: "start" });
    }
    setScrolledPast(false);
    onPastChange(id, false);
  }, [id, onPastChange]);

  useEffect(() => {
    registerReturn(id, returnToAnchor);
    return () => registerReturn(id, null);
  }, [id, registerReturn, returnToAnchor]);

  return (
    <>
      <span className="anchoredInteractionSentinel" ref={sentinelRef} aria-hidden="true" />
      <div
        className={`anchoredInteraction${scrolledPast ? " scrolledPast" : ""}`}
        aria-hidden={scrolledPast || undefined}
      >
        {render(scrolledPast, returnToAnchor, forceExpanded)}
      </div>
      <span className="anchoredInteractionSentinel" ref={cardEndRef} aria-hidden="true" />
    </>
  );
}

export function MessageTimeline({
  messages,
  messageEndRef,
  interaction,
  anchoredInteractions = [],
  onOpenImage
}: Props) {
  const [pastInteractionIds, setPastInteractionIds] = useState<string[]>([]);
  const [forceExpandedIds, setForceExpandedIds] = useState<string[]>([]);
  const returnCallbacks = useRef(new Map<string, () => void>());
  const pinnedInteractions = anchoredInteractions.filter((item) => pastInteractionIds.includes(item.id));

  const handlePastChange = useCallback((id: string, past: boolean) => {
    setPastInteractionIds((ids) => past
      ? (ids.includes(id) ? ids : [...ids, id])
      : ids.filter((item) => item !== id));
    if (past) setForceExpandedIds((ids) => ids.filter((item) => item !== id));
  }, []);

  const registerReturn = useCallback((id: string, callback: (() => void) | null) => {
    if (callback) returnCallbacks.current.set(id, callback);
    else returnCallbacks.current.delete(id);
  }, []);

  function returnToInteraction(id: string) {
    setForceExpandedIds((ids) => ids.includes(id) ? ids : [...ids, id]);
    returnCallbacks.current.get(id)?.();
  }

  function anchoredNodesFor(actionId?: string | null) {
    return anchoredInteractions
      .filter((item) => item.sourceActionId === actionId)
      .map((item) => (
        <AnchoredInteraction
          key={item.id}
          id={item.id}
          render={item.render}
          forceExpanded={forceExpandedIds.includes(item.id)}
          onPastChange={handlePastChange}
          registerReturn={registerReturn}
        />
      ));
  }

  const anchoredSourceIds = new Set(messages.map((message) => message.actionId));
  return (
    <div className="messageViewport">
      <div className="messageColumn">
        {pinnedInteractions.length > 0 && (
          <nav className="pinnedCardStack" aria-label="已折叠的待处理卡片">
            {pinnedInteractions.map((item) => (
              <button key={item.id} type="button" onClick={() => returnToInteraction(item.id)}>
                {item.cardType === "knowledge_card"
                  ? <BookOpen size={14} />
                  : <ClipboardCheck size={14} />}
                <span>{item.title}</span>
                <small>{item.cardType === "knowledge_card" ? "知识卡" : "题目卡"}</small>
                <ChevronDown size={14} />
              </button>
            ))}
          </nav>
        )}
        {messages.length === 0 && !interaction && (
          <div className="welcomeState">
            <div className="welcomeGlyph"><Bot size={30} /></div>
            <h1>从你卡住的地方开始</h1>
            <p>在下方一次输入题目和你想到哪一步，也可以先只发题目。信息不完整时，我会继续追问。</p>
            <div className="welcomeExamples">
              <span>题目：已知……求……</span>
              <span>我的思路：我做到……但不懂……</span>
            </div>
          </div>
        )}

        {messages.map((message) => (<div className="timelineEntry" key={message.id}>
          <article className={`chatMessage ${message.role} ${message.checkpointResult ? "checkpointResponseMessage" : ""}`.trim()}>
            <div className="messageAvatar">
              {message.role === "assistant" ? <Bot size={17} /> : message.role === "student" ? "你" : "·"}
            </div>
            <div className="messageBody">
              {message.checkpointResult ? (
                <CheckpointModal
                  checkpoint={message.checkpointResult.checkpoint}
                  answer={message.checkpointResult}
                />
              ) : (
                <>
                  {message.imageUrl && (
                    <button
                      className="messageImageButton"
                      type="button"
                      onClick={() => onOpenImage?.(message.imageUrl!)}
                      aria-label="放大查看题目图片"
                    >
                      <img className="messageImage" src={message.imageUrl} alt="学生上传的题目" />
                      <span>点击放大</span>
                    </button>
                  )}
                  <div className="messageText"><MathText text={message.text} /></div>
                  {message.role === "assistant" && message.action && (
                    <span className="actionTag" title={`教学 action：${message.action}`}>
                      {ACTION_LABELS[message.action] ?? message.action}
                    </span>
                  )}
                </>
              )}
            </div>
          </article>
          {anchoredNodesFor(message.actionId)}
        </div>))}
        {anchoredInteractions
          .filter((item) => !anchoredSourceIds.has(item.sourceActionId))
          .map((item) => (
            <AnchoredInteraction
              key={item.id}
              id={item.id}
              render={item.render}
              forceExpanded={forceExpandedIds.includes(item.id)}
              onPastChange={handlePastChange}
              registerReturn={registerReturn}
            />
          ))}
        {interaction}
        <div ref={messageEndRef} />
      </div>
    </div>
  );
}
