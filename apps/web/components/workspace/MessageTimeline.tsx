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
  viewportRef?: RefObject<HTMLDivElement | null>;
  interaction?: ReactNode;
  anchoredInteractions?: AnchoredInteractionConfig[];
  onOpenImage?: (imageUrl: string) => void;
  retryableMessageId?: string | null;
  retryBusy?: boolean;
  onRetryMessage?: (message: ChatMessage) => void;
  welcomePhase?: "visible" | "leaving" | "hidden";
  onWelcomeTransitionComplete?: () => void;
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
  onRetryMessage,
  welcomePhase = "hidden",
  onWelcomeTransitionComplete
}: Props) {
  const welcomeCharacterRef = useRef<SVGGElement | null>(null);
  const handoffTargetRef = useRef<HTMLDivElement | null>(null);
  const completedHandoffRef = useRef(false);
  const transitionCompleteRef = useRef(onWelcomeTransitionComplete);
  const internalViewportRef = useRef<HTMLDivElement | null>(null);
  const resolvedViewportRef = viewportRef ?? internalViewportRef;
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
