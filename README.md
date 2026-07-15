# Diagnostic Teaching MVP

诊断式数学答疑 MVP：面向初高中数学题，先诊断学生卡点，再用讲解和检查点选择题推进。

当前版本的核心特征是：**语言模型主导每一轮答疑决策**。后端不是写死“第几步讲什么”的脚本，而是每轮把题目、学生历史、当前阶段和 JSON 输出合同发给 LLM，由 LLM 返回结构化 `TutorTurn`：

```txt
state_hint + action + message + breakpoint_description + checkpoint + knowledge_card + problem_card
```

后端负责校验、落库、日志、流式输出和兜底；前端负责展示聊天、渲染 LaTeX 公式、标注每条 AI 消息对应的教学 action、弹出检查点并把学生选择回传给模型。

当前已支持：文本题目与单张 PNG/JPEG/WebP 题图、可切换的加密模型配置、检查点选择题、跨 session 的全局知识卡片/题目卡片库、SQLite 历史恢复与删除，以及 JSONL/Markdown 双份诊断日志。图片识别先把 KaTeX 格式题目和可见作答/批改痕迹填入两个可编辑文本框；只有题目必须看图时，正式答疑才额外携带用户原图并要求使用标记为多模态的模型。

知识卡片策略为：`EXPLAIN_PRINCIPLE` 必须输出，`EXPLAIN_LOCAL` 仅在讲解包含值得独立记忆、可迁移复用的公式、定理、性质或方法辨析时由模型选择输出；任一 knowledge card 都会在消息结束后弹窗，关闭归档后继续答疑。

## 本地启动

首次运行先按 `docs/how-to-run.md` 完成 Conda 环境和前端依赖安装。

双击：

```txt
scripts/start-dev.cmd
```

打开：

```txt
http://127.0.0.1:3000
```

关闭：

```txt
scripts/stop-dev.cmd
```

首次安装、启动、关闭和排查说明见：

```txt
docs/how-to-run.md
```

## 核心机制（必读）

如果后续要优化“AI 怎么教、什么时候弹检查点、答错后怎么恢复”，请先读：

- `docs/state-machine.md`：答疑状态机与 LLM 主导流程（`state_hint/action/checkpoint/card` 如何由模型决定，后端如何守门）
- `docs/context-management.md`：上下文管理与诊断日志（prompt 拼装、history、检查点/卡片回传、SSE、SQLite、JSONL）
- `docs/ai-model-config-v0.2.md`：模型配置 API、密钥存储和多模态标记
- `docs/changelog.md`：版本改动记录

`docs/tutoring-agent-mvp-dev-doc-v0.2.md` 仅保留立项时的历史设计基线；出现冲突时，以现行代码、测试和上面三份现行说明为准。

一句话理解当前架构：

```txt
学生输入/检查点选择
  -> SQLite 取完整结构化历史
  -> build_messages 按 system / user / assistant 多轮消息拼 prompt
  -> LLM 产出 TutorTurn JSON
  -> 后端校验 checkpoint/card + SQLite 落库 + 追加诊断日志
  -> SSE 流式推给前端
  -> 前端展示 message / KaTeX 公式 / checkpoint 或学习卡片弹窗
```

## 技术栈

- Frontend: Next.js + React + TypeScript
- Math Rendering: KaTeX（聊天气泡和检查点题干/选项支持 `$...$`、`$$...$$`、`\(...\)`、`\[...\]`）
- Backend: FastAPI
- Database: SQLite（session、结构化消息、checkpoint 和全局 study_cards 的权威存储，也是历史恢复来源）
- Diagnostic Log: JSONL（机器审计）+ Markdown（留白充足的人类阅读版）
- Model API: OpenAI-compatible chat completions（**已支持流式 stream=true**）

## 目录

```txt
apps/api   FastAPI 后端
  app/core/teaching_controller.py    LLM 决策合同 + prompt + 流式生成器 + fallback
  app/core/streaming.py              增量 JSON message 解析器（打字机）
  app/llm/provider.py                流式 chat completions
  app/routes/problem_images.py       题图识别与必要题图裁剪
  app/storage/session_logger.py      SessionLogger（JSONL + Markdown 诊断记录）
apps/web   Next.js 前端
  components/MathText.tsx            KaTeX 数学公式渲染
docs       文档
scripts    Windows 启动、关闭、调试脚本
config     模型配置预设示例
```

## 诊断卡点怎么看

跑一次会话后，每个 session 同时生成两份诊断日志：

```txt
logs/sessions/<session_id>.jsonl
logs/sessions/<session_id>.log.md
```

`.jsonl` 每行一个事件，适合脚本处理和审计；`.log.md` 按事件和消息分段并保留大量空行，适合直接阅读。两者都是只追加诊断数据，不参与业务恢复；历史会话列表与恢复全部从 SQLite 读取，恢复时复制为一个新的 session，保留原 session 不变。

读取示例：

```bat
scripts\inspect-session.cmd sess_xxxxxxxxxxxx
```

详见 `docs/context-management.md`。

## 优化入口

最常改的地方：

- `SYSTEM_PROMPT`：调整老师角色、讲解粒度、检查点策略。
- `JSON_CONTRACT`：调整 LLM 输出字段和格式要求。
- `validate_checkpoint()`：提高检查点质量门槛。
- `build_messages()`：改变历史、阶段、题目如何喂给模型。
- `handleCheckpoint()`：改变学生选择如何被表述给 LLM。

建议每次策略改动后，用 `logs/sessions/<session_id>.jsonl` 对比 `prompt_messages`、`raw_response`、`parsed_turn` 和 `checkpoint_answer`，不要只看页面体感。

## 注意

本地运行数据、日志和 API key 加密文件不会提交到 Git：

```txt
data/
logs/
apps/web/node_modules/
apps/web/.next/
```
