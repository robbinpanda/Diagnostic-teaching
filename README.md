# Diagnostic Teaching MVP

诊断式数学答疑 MVP：面向初高中数学题，先诊断学生卡点，再用讲解和检查点选择题推进。

当前版本的核心特征是：**语言模型主导每一轮答疑决策**。后端不是写死“第几步讲什么”的脚本，而是每轮把题目、学生历史、当前阶段和 JSON 输出合同发给 LLM，由 LLM 返回结构化 `TutorTurn`：

```txt
phase + action + message + breakpoint + checkpoint
```

后端负责校验、落库、日志、流式输出和兜底；前端负责展示聊天、渲染 LaTeX 公式、弹出检查点并把学生选择回传给模型。

## 本地启动

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

更详细说明见：

```txt
docs/how-to-run.md
```

## 核心机制（必读）

如果后续要优化“AI 怎么教、什么时候弹检查点、答错后怎么恢复”，请先读：

- `docs/state-machine.md`：答疑状态机与 LLM 主导流程（`phase/action/checkpoint` 如何由模型决定，后端如何守门）
- `docs/context-management.md`：上下文管理与诊断日志（prompt 拼装、history、检查点回传、SSE、JSONL）
- `docs/changelog.md`：最近改动记录

一句话理解当前架构：

```txt
学生输入/检查点选择
  -> SQLite 取最近历史
  -> build_messages 拼 prompt
  -> LLM 产出 TutorTurn JSON
  -> 后端校验 checkpoint + 落库 + JSONL
  -> SSE 流式推给前端
  -> 前端展示 message / KaTeX 公式 / checkpoint 弹窗
```

## 技术栈

- Frontend: Next.js + React + TypeScript
- Math Rendering: KaTeX（聊天气泡和检查点题干/选项支持 `$...$`、`$$...$$`、`\(...\)`、`\[...\]`）
- Backend: FastAPI
- Database: SQLite（业务态主存储）
- Diagnostic Log: JSONL（`logs/sessions/<session_id>.jsonl`，全量诊断回放）
- Model API: OpenAI-compatible chat completions（**已支持流式 stream=true**）

## 目录

```txt
apps/api   FastAPI 后端
  app/core/teaching_controller.py    LLM 决策合同 + prompt + 流式生成器 + fallback
  app/core/streaming.py              增量 JSON message 解析器（打字机）
  app/llm/provider.py                流式 chat completions
  app/storage/session_logger.py      SessionLogger（jsonl 全量记录）
apps/web   Next.js 前端
  components/MathText.tsx            KaTeX 数学公式渲染
docs       文档
scripts    Windows 启动、关闭、调试脚本
config     模型配置预设示例
```

## 诊断卡点怎么看

跑一次会话后，每个 session 的全量诊断日志写到：

```txt
logs/sessions/<session_id>.jsonl
```

每行一个事件，包含完整 prompt、LLM 原始返回（含 markdown/fence）、是否走 fallback、检查点全选项正误标签、耗时等。SQLite 仍是业务态主存储，JSONL 只写不读，专门用于“看卡点”。

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
