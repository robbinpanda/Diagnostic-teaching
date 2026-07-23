import { Bot } from "lucide-react";
import type { ReactNode, RefObject } from "react";
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
};

export function MessageTimeline({ messages, messageEndRef, interaction }: Props) {
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

        {messages.map((message) => (
          <article
            className={`chatMessage ${message.role} ${message.checkpointResult ? "checkpointResponseMessage" : ""}`.trim()}
            key={message.id}
          >
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
                  {message.imageUrl && <img className="messageImage" src={message.imageUrl} alt="学生上传的题目" />}
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
        ))}
        {interaction}
        <div ref={messageEndRef} />
      </div>
    </div>
  );
}
