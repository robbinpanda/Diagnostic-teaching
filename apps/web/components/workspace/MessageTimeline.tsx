import { Bot } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
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

type Props = {
  messages: ChatMessage[];
  messageEndRef: RefObject<HTMLDivElement | null>;
  interaction?: ReactNode;
  anchoredInteraction?: {
    sourceActionId: string;
    render: (autoCollapsed: boolean, returnToAnchor: () => void) => ReactNode;
  };
  onOpenImage?: (imageUrl: string) => void;
};

export function anchoredInteractionScrollTop(
  currentScrollTop: number,
  viewportTop: number,
  anchorTop: number
) {
  return Math.max(0, currentScrollTop + anchorTop - viewportTop - 20);
}

function AnchoredInteraction({
  render
}: {
  render: (autoCollapsed: boolean, returnToAnchor: () => void) => ReactNode;
}) {
  const sentinelRef = useRef<HTMLSpanElement | null>(null);
  const [scrolledPast, setScrolledPast] = useState(false);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    const viewport = sentinel?.closest(".messageViewport");
    if (!sentinel || !(viewport instanceof HTMLElement)) return;

    const update = () => {
      const viewportTop = viewport.getBoundingClientRect().top + 10;
      setScrolledPast(sentinel.getBoundingClientRect().top < viewportTop);
    };
    update();
    viewport.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      viewport.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  function returnToAnchor() {
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
  }

  return (
    <>
      <span className="anchoredInteractionSentinel" ref={sentinelRef} aria-hidden="true" />
      <div className={`anchoredInteraction${scrolledPast ? " scrolledPast" : ""}`}>
        {render(scrolledPast, returnToAnchor)}
      </div>
    </>
  );
}

export function MessageTimeline({
  messages,
  messageEndRef,
  interaction,
  anchoredInteraction,
  onOpenImage
}: Props) {
  const anchorIndex = anchoredInteraction
    ? messages.findIndex((message) => message.actionId === anchoredInteraction.sourceActionId)
    : -1;
  const anchoredNode = anchoredInteraction
    ? <AnchoredInteraction render={anchoredInteraction.render} />
    : null;
  return (
    <div className="messageViewport">
      <div className="messageColumn">
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

        {messages.map((message, index) => (<div className="timelineEntry" key={message.id}>
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
          {index === anchorIndex ? anchoredNode : null}
        </div>))}
        {anchoredInteraction && anchorIndex < 0 ? anchoredNode : null}
        {interaction}
        <div ref={messageEndRef} />
      </div>
    </div>
  );
}
