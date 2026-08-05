import { BookOpen, Bot, Camera, ChevronDown, ClipboardCheck, MessageCircleMore, PencilLine } from "lucide-react";
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
  floatingObstacleRef?: RefObject<HTMLElement | null>;
  floatingObstacleActive?: boolean;
};

type LayoutRect = Pick<DOMRect, "bottom" | "left" | "right" | "top" | "width">;

export function floatingCardAvoidanceWidth(
  messageRect: LayoutRect,
  cardRect: LayoutRect,
  gap = 18,
  minimumWidth = 220
) {
  const overlapsVertically = Math.min(messageRect.bottom, cardRect.bottom)
    > Math.max(messageRect.top, cardRect.top);
  const overlapsHorizontally = cardRect.left < messageRect.right && cardRect.right > messageRect.left;
  if (!overlapsVertically || !overlapsHorizontally) return null;

  const availableWidth = Math.min(messageRect.width, cardRect.left - messageRect.left - gap);
  return availableWidth >= minimumWidth ? availableWidth : null;
}

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
  interaction,
  anchoredInteractions = [],
  onOpenImage,
  floatingObstacleRef,
  floatingObstacleActive = false
}: Props) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [pastInteractionIds, setPastInteractionIds] = useState<string[]>([]);
  const [forceExpandedIds, setForceExpandedIds] = useState<string[]>([]);
  const returnCallbacks = useRef(new Map<string, () => void>());
  const pinnedInteractions = anchoredInteractions.filter((item) => pastInteractionIds.includes(item.id));

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    let frame = 0;
    let settleFrame = 0;
    const clearAvoidance = (
      messages: Iterable<HTMLElement> = viewport.querySelectorAll<HTMLElement>(".chatMessage.avoidsKnowledgeCard")
    ) => {
      for (const message of messages) {
        message.classList.remove("avoidsKnowledgeCard");
        message.style.removeProperty("--knowledge-card-avoidance-width");
      }
    };
    const scheduleUpdate = () => {
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(settleFrame);
      frame = window.requestAnimationFrame(() => {
        const messages = Array.from(viewport.querySelectorAll<HTMLElement>(".chatMessage"));
        const card = floatingObstacleRef?.current;
        if (!floatingObstacleActive || !card || window.matchMedia("(max-width: 900px)").matches) {
          clearAvoidance(messages);
          return;
        }

        const cardRect = card.getBoundingClientRect();
        const viewportRect = viewport.getBoundingClientRect();
        if (cardRect.bottom <= viewportRect.top || cardRect.top >= viewportRect.bottom) {
          clearAvoidance(messages);
          return;
        }

        const updates = messages.map((message) => {
          const messageRect = message.getBoundingClientRect();
          const visible = messageRect.bottom > viewportRect.top && messageRect.top < viewportRect.bottom;
          return {
            message,
            width: visible ? floatingCardAvoidanceWidth(messageRect, cardRect) : null
          };
        });

        updates.forEach(({ message, width }) => {
          if (width === null) {
            message.classList.remove("avoidsKnowledgeCard");
            message.style.removeProperty("--knowledge-card-avoidance-width");
            return;
          }
          message.classList.add("avoidsKnowledgeCard");
          message.style.setProperty("--knowledge-card-avoidance-width", `${Math.floor(width)}px`);
        });
        settleFrame = window.requestAnimationFrame(() => {
          const settledCard = floatingObstacleRef?.current;
          if (settledCard && settledCard.getBoundingClientRect().height !== cardRect.height) scheduleUpdate();
        });
      });
    };

    const card = floatingObstacleRef?.current;
    const resizeObserver = new ResizeObserver(scheduleUpdate);
    resizeObserver.observe(viewport);
    if (card) resizeObserver.observe(card);
    const mutationObserver = new MutationObserver(scheduleUpdate);
    mutationObserver.observe(viewport, { childList: true, characterData: true, subtree: true });
    viewport.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    scheduleUpdate();

    return () => {
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(settleFrame);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      viewport.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      clearAvoidance();
    };
  }, [floatingObstacleActive, floatingObstacleRef, messages.length]);

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
    <div className="messageViewport" ref={viewportRef}>
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
