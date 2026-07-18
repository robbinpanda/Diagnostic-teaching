# Diagnostic Teaching MVP

诊断式数学答疑 MVP：面向初高中数学题，先诊断学生卡点，再用讲解和检查点选择题推进。

当前版本的核心特征是：**语言模型主导每一轮答疑决策**。后端不是写死“第几步讲什么”的脚本，而是每轮把题目、学生历史、当前阶段和 JSON 输出合同发给 LLM，由 LLM 返回结构化 `TutorTurn`：

```txt
state_hint + action + message + breakpoint_description + checkpoint + knowledge_card + problem_card
```

后端负责校验、落库、日志、流式输出和兜底；前端负责展示聊天、渲染 LaTeX 公式、标注每条 AI 消息对应的教学 action、弹出检查点并把学生选择回传给模型。

当前已支持：文本题目与单张 PNG/JPEG/WebP 题图、可切换的加密模型配置、检查点选择题、跨 session 的全局知识卡片/题目卡片库、学习卡片 PDF 多排版导出、SQLite 历史会话与删除，以及 JSONL/Markdown 双份诊断日志。页面采用左侧会话、中央对话、右侧卡片的三栏布局；建会话和会话内回复共用底部输入框，不再把“题目”和“你想到哪一步”拆成两个表单。

SQLite schema 由 Alembic 统一管理。后端启动时自动升级到最新 revision；旧版无 Alembic 标记的数据库会在保留业务数据的前提下建立迁移基线。每条应用连接启用 foreign keys、WAL 与 5 秒 busy timeout，具体约束、备份和 Windows 本地运行行为见 `docs/database.md`。

模型设置支持在同一套供应商 Base URL/API key 下批量添加多个 model name。每个模型独立设置是否多模态；连接测试会逐模型显示成功或失败，并用内置样例图自动探测未勾选模型的图片能力。模型选择器统一显示为“供应商名称 · model name”。

`POST /api/sessions/intake` 会累计统一输入中的题目和学生已有思路：缺题目就追问题目，只有题目就追问“想到哪一步”，两项齐备后才创建正式 session。图片识别结果也进入同一 intake；上传图片创建的 session 会保留用户原图并绑定多模态模型。

左侧会话栏直接从 SQLite 读取并通过 `GET /api/sessions/{session_id}` 打开原 session，不会仅因查看而复制记录；原有 `POST /api/sessions/restore` 仍保留给需要显式创建实验分支的调用方。左侧可清空全部会话和 session 日志，右侧可清空全部卡片；两项操作都需要二次确认，且互不删除对方保留的数据。

知识卡片策略为：`EXPLAIN_PRINCIPLE` 必须输出，`EXPLAIN_LOCAL` 仅在讲解包含值得独立记忆、可迁移复用的公式、定理、性质或方法辨析时由模型选择输出；任一 knowledge card 都会在消息结束后弹窗，关闭归档后继续答疑。

已归档知识卡片和题目卡片可以在“导出学习卡片”中混合选择后导出 PDF。窗口默认全选，并按 `saved_at` 从新到旧排列；取消全选后逐张点击时，选择编号就是打印顺序，再次点击会取消，重新选中则追加到末尾。排版预设包括 A4 竖版单列、A4 竖版双列和 A4 横版三列；默认双列。打印稿按“先从上到下填满左列，再流向右列”的报纸式顺序排版，普通卡片尽量保持完整，单张特别长时只在内容分区之间续排。导出会打开系统打印面板，选择“另存为 PDF”即可保留 KaTeX 公式与彩色版式。

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
- `docs/database.md`：Alembic 迁移、SQLite 外键/索引/删除语义，以及 Windows WAL 运行说明
- `docs/ai-model-config-v0.2.md`：模型配置 API、密钥存储和多模态标记
- `docs/changelog.md`：版本改动记录

`docs/tutoring-agent-mvp-dev-doc-v0.2.md` 仅保留立项时的历史设计基线；出现冲突时，以现行代码、测试和上面的现行说明为准。

一句话理解当前架构：

```txt
统一输入 intake（题目 + 当前思路）/ 会话消息 / 检查点选择
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
- Database: SQLite + Alembic（session、结构化消息、checkpoint 和全局 study_cards 的权威存储；启用 foreign keys、WAL 和 busy timeout）
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
  migrations/                        Alembic schema revision（数据库演进唯一入口）
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

`.jsonl` 每行一个事件，适合脚本处理和审计；`.log.md` 按事件和消息分段并保留大量空行，适合直接阅读。两者都是只追加诊断数据，不参与业务恢复；历史会话列表、直接打开和显式分支恢复都只读 SQLite。左栏直接打开保持原 session id，调用 `POST /api/sessions/restore` 时才复制为新的 session。

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
