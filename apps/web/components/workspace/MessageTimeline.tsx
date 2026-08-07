import {
  BookOpen,
  ChevronDown,
  ClipboardCheck,
  RotateCcw
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { ChatMessage } from "../../lib/timeline";
import { CheckpointModal } from "../CheckpointModal";
import { MathText } from "../MathText";
import { PandaAvatar } from "./PandaArtwork";
import { PandaWelcome } from "./PandaWelcome";

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
  retryableMessageId?: string | null;
  retryBusy?: boolean;
  onRetryMessage?: (message: ChatMessage) => void;
  welcomePhase?: "visible" | "leaving" | "hidden";
  onWelcomeTransitionComplete?: () => void;
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
  floatingObstacleActive = false,
  retryableMessageId,
  retryBusy = false,
  onRetryMessage,
  welcomePhase = "hidden",
  onWelcomeTransitionComplete
}: Props) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const welcomeCharacterRef = useRef<SVGGElement | null>(null);
  const handoffTargetRef = useRef<HTMLDivElement | null>(null);
  const completedHandoffRef = useRef(false);
  const transitionCompleteRef = useRef(onWelcomeTransitionComplete);
  const [pastInteractionIds, setPastInteractionIds] = useState<string[]>([]);
  const [forceExpandedIds, setForceExpandedIds] = useState<string[]>([]);
  const returnCallbacks = useRef(new Map<string, () => void>());
  const pinnedInteractions = anchoredInteractions.filter((item) => pastInteractionIds.includes(item.id));
  const latestAssistantId = messages.findLast((message) => message.role === "assistant")?.id;
  const firstAssistantId = messages.find((message) => message.role === "assistant")?.id;

  useEffect(() => {
    transitionCompleteRef.current = onWelcomeTransitionComplete;
  }, [onWelcomeTransitionComplete]);

  useEffect(() => {
    if (welcomePhase === "visible") completedHandoffRef.current = false;
  }, [welcomePhase]);

  useLayoutEffect(() => {
    if (welcomePhase !== "leaving" || !firstAssistantId || completedHandoffRef.current) return;
    const source = welcomeCharacterRef.current;
    const target = handoffTargetRef.current;
    if (!source || !target) return;
    completedHandoffRef.current = true;

    const sourceRect = source.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (
      reducedMotion
      || sourceRect.width <= 0
      || targetRect.width <= 0
      || typeof target.animate !== "function"
    ) {
      transitionCompleteRef.current?.();
      return;
    }

    const sourceCenterX = sourceRect.left + sourceRect.width / 2;
    const sourceCenterY = sourceRect.top + sourceRect.height / 2;
    const targetCenterX = targetRect.left + targetRect.width / 2;
    const targetCenterY = targetRect.top + targetRect.height / 2;
    const scale = sourceRect.width / targetRect.width;
    source.style.opacity = "0";
    target.classList.add("pandaAvatarHandoff");
    const animation = target.animate(
      [
        {
          transform: `translate3d(${sourceCenterX - targetCenterX}px, ${sourceCenterY - targetCenterY}px, 0) scale(${scale})`,
          opacity: 1
        },
        { transform: "translate3d(0, 0, 0) scale(1)", opacity: 1 }
      ],
      { duration: 720, easing: "cubic-bezier(0.16, 1, 0.3, 1)", fill: "both" }
    );
    let cancelled = false;
    animation.finished
      .catch(() => undefined)
      .then(() => {
        if (cancelled) return;
        target.classList.remove("pandaAvatarHandoff");
        transitionCompleteRef.current?.();
      });
    return () => {
      cancelled = true;
      animation.cancel();
      source.style.removeProperty("opacity");
      target.classList.remove("pandaAvatarHandoff");
    };
  }, [firstAssistantId, welcomePhase]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    let frame = 0;
    let settleFrame = 0;
    const clearAvoidance = (
      messages: Iterable<HTMLElement> = viewport.querySelectorAll<HTMLElement>(
        ".chatMessage.avoidsKnowledgeCard, .messageRetryRow.avoidsKnowledgeCard"
      )
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
        const messages = Array.from(viewport.querySelectorAll<HTMLElement>(
          ".chatMessage, .messageRetryRow"
        ));
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
      {welcomePhase !== "hidden" ? (
        <PandaWelcome phase={welcomePhase} characterRef={welcomeCharacterRef} />
      ) : null}
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
        {messages.map((message) => {
          const isAssistant = message.role === "assistant";
          const isLatestAssistant = message.id === latestAssistantId;
          const isHandoffTarget = welcomePhase === "leaving" && message.id === firstAssistantId;
          return (<div className="timelineEntry" key={message.id}>
          <article className={`chatMessage ${message.role} ${message.checkpointResult ? "checkpointResponseMessage" : ""}`.trim()}>
            <div
              className={`messageAvatar${isAssistant ? " pandaMessageAvatar" : ""}${isLatestAssistant && message.streamState === "streaming" ? " pandaAvatarHop" : ""}`}
              ref={isHandoffTarget ? handoffTargetRef : undefined}
              aria-label={isAssistant ? "熊猫助教" : undefined}
            >
              {isAssistant ? <PandaAvatar /> : message.role === "student" ? "你" : "·"}
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
        </div>);
        })}
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
