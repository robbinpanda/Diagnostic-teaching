import {
  BookOpen,
  Bot,
  Camera,
  ChevronDown,
  ClipboardCheck,
  MessageCircleMore,
  PencilLine,
  RotateCcw
} from "lucide-react";
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
  viewportRef?: RefObject<HTMLDivElement | null>;
  interaction?: ReactNode;
  anchoredInteractions?: AnchoredInteractionConfig[];
  onOpenImage?: (imageUrl: string) => void;
  retryableMessageId?: string | null;
  retryBusy?: boolean;
  onRetryMessage?: (message: ChatMessage) => void;
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
  const scrolledPastRef = useRef(false);
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
      if (scrolledPastRef.current === nextScrolledPast) return;
      scrolledPastRef.current = nextScrolledPast;
      setScrolledPast(nextScrolledPast);
      onPastChange(id, nextScrolledPast);
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
    scrolledPastRef.current = false;
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
  viewportRef,
  interaction,
  anchoredInteractions = [],
  onOpenImage,
  retryableMessageId,
  retryBusy = false,
  onRetryMessage
}: Props) {
  const internalViewportRef = useRef<HTMLDivElement | null>(null);
  const resolvedViewportRef = viewportRef ?? internalViewportRef;
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
    <div className="messageViewport" ref={resolvedViewportRef}>
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
            <div className="welcomeCopy">
              <h1>今天想解决什么问题？</h1>
              <p>上传或输入题目，AI 会循着你的思路逐步分析，陪你真正弄懂每一道题。</p>
              <div className="welcomeExamples" aria-label="支持的答疑方式">
                <span><Camera size={16} />拍照 / 上传题目</span>
                <span><PencilLine size={16} />输入题目</span>
                <span><MessageCircleMore size={16} />连续追问</span>
              </div>
            </div>
            <div className="knowledgeOrbit" aria-hidden="true">
              <span className="orbit orbitOne" />
              <span className="orbit orbitTwo" />
              <span className="orbitDot dotOne" />
              <span className="orbitDot dotTwo" />
              <span className="orbitDot dotThree" />
              <span className="paperShape paperOne" />
              <span className="paperShape paperTwo" />
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
          {message.role === "student" && message.id === retryableMessageId && (
            <div className="messageRetryRow">
              <button
                className="messageRetryButton"
                type="button"
                disabled={retryBusy}
                onClick={() => onRetryMessage?.(message)}
                aria-label="重试这条消息对应的答疑"
              >
                <RotateCcw size={13} />
                {retryBusy ? "正在重试" : "重试本轮"}
              </button>
            </div>
          )}
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
