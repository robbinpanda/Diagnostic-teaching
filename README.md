# Diagnostic Teaching MVP

诊断式数学答疑 MVP：面向初高中数学题，先诊断学生卡点，再用讲解和检查点选择题推进。

当前版本的核心特征是：**语言模型主导每一轮答疑决策**。后端不是写死“第几步讲什么”的脚本，而是每轮把题目、学生历史、当前阶段和 JSON 输出合同发给 LLM，由 LLM 返回结构化 `TutorTurn`：

```txt
context_status + problem/thought summary + state_hint + action + message + breakpoint_description + checkpoint + knowledge_card + problem_card
```

后端负责校验、落库、日志、流式输出和兜底；前端负责展示聊天、渲染 LaTeX 公式、标注每条 AI 消息对应的教学 action，并把检查点和待归档卡片嵌入消息时间线。模型输出使用按 action 区分的最小联合合同：`message` 固定排在最前，只有需要的 checkpoint/card 字段才出现，其他字段不再用 `null` 占位；后端解析后仍补成统一 `TutorTurn`，因此 SQLite 和前端业务结构保持兼容。

当前已支持：SenseVoiceSmall 本地语音转写输入、文字单题/多题自动拆分、PNG/JPEG/WebP 题图的多题框检测与可编辑裁剪、按题目批量创建独立答疑 session、OpenAI-compatible / Anthropic 双协议加密模型配置、自动同步的 OpenCode 免费模型、检查点选择题、跨 session 的全局知识卡片/题目卡片库、层级卡片文件夹与复制/剪切/移动、基于目录树选择的学习卡片 PDF 多排版导出、SQLite 历史会话与删除、按 session 严格递增的 durable events 与断线重放 SSE，以及 JSONL/Markdown 双份诊断日志。页面采用左侧会话、中央对话、右侧卡片的三栏布局；建会话和会话内回复共用底部输入框，不再把“题目”和“你想到哪一步”拆成两个表单。

SQLite schema 由 Alembic 统一管理。后端启动时自动升级到最新 revision；旧版无 Alembic 标记的数据库会在保留业务数据的前提下建立迁移基线。每条应用连接启用 foreign keys、WAL 与 5 秒 busy timeout，具体约束、备份和 Windows 本地运行行为见 `docs/database.md`。

前端会话运行态由 timeline reducer、互斥 workflow 状态机和按 session 隔离的 stream controller 管理。切换会话或新建答疑只切换当前视图，不会关闭其他 session 的 HTTP 流；多个 session 可以同时生成，同一 session 的新 run 仍只会替换该 session 的旧 run。点击停止只中断当前打开的 session，页面卸载才统一收束所有本地流。每个 chat 事件同时绑定 session id 与本地 run id，后台流不能写入后来打开的 session；重新打开仍在生成的 session 时，页面从 SQLite 快照恢复已提交内容并重新接回该 session 的活动流。高频 `message_delta/message_reset` 没有 durable seq；稳定业务边界由独立的 session-events SSE 提供严格递增的 `seq` 和断线重放。

模型设置支持在同一套供应商 Base URL/API key 下批量添加多个 model name，并可选择 OpenAI-compatible chat completions 或 Anthropic Messages 协议。多个 model name 的连接测试最多四项并行执行，每个模型独立显示成功或失败并设置是否多模态；图片能力使用每次随机排列的颜色/图形挑战验证模型是否真正读懂图片，而不是只判断请求是否返回文字。模型选择器会根据名称长度自适应宽度，长名称自动省略，多模态项显示“支持上传图片”；管理模式可复选并原子批量删除自定义配置。用户配置显示为“供应商名称 · model name”；OpenCode 托管免费模型显示为 `opencodefree-<model-id>`，由 `models.dev` 目录同步协议与图片能力，且不能手动删除。

每个 profile 另有持久化的三档推理强度 `none / low / high`，前端显示为“关闭 / 低 / 高”，默认是“低”。后端不再按供应商名称、Base URL 或 model family 猜测能力：OpenAI 与 OpenAI-compatible chat completions 统一发送顶层 `reasoning_effort`，Anthropic Messages 统一发送 `output_config.effort`。添加模型时，连接测试会针对同一个 `protocol + Base URL + API key + model` 并发发出三个极简会话，分别携带 `none / low / high`；报错档位会从该 profile 的可选项中移除并持久化。用户跳过测试时默认保留三档，符合不同代理对同一模型可能支持不同档位的实际情况。同一已保存档位作用于正式答疑、上传后的图片题目框检测、兼容图片内容识别接口和图片能力测试；不再用 system prompt 模拟推理强度。OpenCode 托管 profile 仍不能改目录字段或删除，但允许保存本地推理档位偏好。

输入框旁的“初中 / 高中”选择会在创建 session 时固化为 `grade_band`，并随每轮 `SESSION_START` 上下文发送给答疑模型，用于提示知识范围、讲解粒度和推导深度：初中侧重基础概念、直观解释与规范步骤，高中允许使用高中知识、综合方法与完整推导。它不会切换模型或供应商，也不是后端课程知识点白名单；进入答疑后不能修改，避免同一 session 的教学口径中途变化。

教学上下文的前置 intake 已取消；新增的拆题阶段只决定“一段输入要创建几个 session”，不参与教学 action。文字首发先调用 `POST /api/problem-intake/analyze-text`，由当前选定模型返回严格 `problems[]` JSON；单题返回一项，多题返回多个自包含题目，再由 `POST /api/sessions/batch-start` 在同一 SQLite 事务中为每题创建正式 session、写入 `session_inputs` 并保存首条 `STUDENT_RESPONSE`。每个子会话都有稳定 session id 与 `client_message_id`，整批重试不会重复创建。进入正式 session 后，题目和学生思路仍由答疑模型按完整对话语义更新；`context_status=need_problem|need_thought` 时后端强制只允许 `ASK_OPEN_QUESTION`，两项明确后进入 `ready`。

正式 session 的学生输入采用“先接纳、后生成”：普通消息先调用 `POST /api/sessions/{session_id}/inputs`，携带稳定的 `client_message_id`，服务端在一个 SQLite 事务中写入 `session_inputs` 和 `STUDENT_RESPONSE` message；随后 `/api/chat/stream` 只负责读取已落库上下文并生成。首次接纳返回 `201 + accepted`，同 ID 同内容重试返回 `200 + duplicate` 和原始结果，同 ID 不同内容返回 `409 IDEMPOTENCY_KEY_CONFLICT`。旧客户端仍可在 `/api/chat/stream` 中携带 message，后端会先走同一接纳服务。

Checkpoint answer 也进入 `session_inputs`，并由数据库唯一约束保证每个 checkpoint 只成功回答一次：相同选项重试返回第一次的结果，不同选项重试返回 `409 CHECKPOINT_ANSWER_CONFLICT`。提交后的 checkpoint 会作为结构化用户作答卡片留在消息时间线，保留原题与全部选项，并把正确选择标绿、错误选择标红；重新打开历史会话时从 SQLite checkpoint 与 message metadata 恢复，不展示内部使用的冗长答案文本。知识卡片解决后的继续命令使用 `CARD_DISMISSED_CONTINUE`：保存会原子归档最终编辑内容，舍弃则原子记录控制输入并删除待归档卡片，两种选择完成后才触发继续生成。事件重放由 `session_events` 承担，生成中断与重启遗留清理由 `session_runs` 承担，两者不混入输入接纳服务。

左侧会话栏直接从 SQLite 读取并通过 `GET /api/sessions/{session_id}` 打开原 session，不会仅因查看而复制记录；选择某个 session 后会话栏保持展开，只有用户主动点击收起按钮或初次进入窄屏布局时才收起。原有 `POST /api/sessions/restore` 仍保留给需要显式创建实验分支的调用方。左侧可清空全部会话和 session 日志，右侧可清空全部卡片；两项操作都需要二次确认，且互不删除对方保留的数据。

图片上传不再立即建会话。`POST /api/problem-images/detect` 使用当前选定的多模态模型返回最多 20 个归一化题目框；每个框必须同时覆盖完整题干、该题全部学生演算/草稿/最终答案和批改痕迹，学生过程写在题干下方、右侧或空白处时也不能截掉。前端在原图上叠加框，支持手动拖拽新增框、点选后按 Delete/Backspace 删除、拖动平移、拖动四边和四角缩放。用户确认后，`POST /api/sessions/image-batch-start` 在后端按最终框从原图裁剪，并在同一 SQLite 事务中创建等量 session；每个 session 只保存自己的裁剪题图，全部继续使用同一个多模态答疑模型。前端打开第一题并并行启动各 session，其他题同步出现在左侧列表中。

输入框的麦克风按钮通过 `WS /api/speech/stream` 把浏览器音频持续重采样为 16 kHz 单声道 16 位 PCM，录音连接没有总时长上限。后端复用 FunASR `fsmn-vad` 的连接级流式缓存判断说话起止，发声期间约每 1.2 秒用 `iic/SenseVoiceSmall` 更新临时文字；600 毫秒的 VAD 句尾只进入待确认状态，2.5 秒内重新开口会把前后音频合并，连续静音达到 `SENSEVOICE_COMMIT_SILENCE_MS` 或用户停止后才返回最终文字。为控制本地资源，后端按 `SENSEVOICE_STREAM_SEGMENT_SECONDS`（默认 30 秒）滚动提交连续语音并立即丢弃已处理 PCM，连续静音也会周期性清空；单连接原始音频缓冲默认不超过约 0.92 MiB。推理使用的临时 WAV 会在每次识别结束后自动删除，不写入 `data/`、`logs/` 或 SQLite。中文片段不强制插入空格，临时结果末尾的句号也不会写入输入框；结果仍只供用户校对，不会自动发送。

每次 `POST /api/chat/stream` 现在都有持久化 `run_id` 和递增 `attempt`，状态依次为 `queued -> running -> completed`，异常或中断则进入 `failed / interrupted`。同一 session 的 run 按进入顺序串行，不同 session 可并行；`GET /api/sessions/{session_id}/run` 可查询活动或最新 run，`POST /api/sessions/{session_id}/interrupt` 会显式取消 provider 请求和后续 bounded loop，空闲或重复中断是幂等 no-op。浏览器仅停止读取不会伪装成显式中断，而会记录为结构化 `failed/client_disconnected`。

run 中只有完整解析并通过 SQLite 事务提交的教学 action 才进入会话历史；流式显示到一半的 step 不会写成 assistant message。应用启动时会把上次进程遗留的 `queued/running` run 标为 `failed/process_restarted`，不会静默恢复可能重复的 provider 工作。

生成期间 chat SSE 会发送不含原始思维内容的安全 `progress`：正在读取题目、正在核对你的思路、正在选择下一步教学方式、正在组织回复。provider 的 reasoning chunk 只用于切换固定阶段文案，不把原始 CoT 发到浏览器。每个 `tutor_turn` 日志同时记录 `input_to_first_progress_ms`、`input_to_first_reasoning_event_ms`、`input_to_first_content_ms`、`input_to_first_visible_message_ms`、`input_to_interactive_turn_ms` 与 `total_completion_ms`。

知识卡片策略为：`EXPLAIN_PRINCIPLE` 必须输出，`EXPLAIN_LOCAL` 仅在讲解包含值得独立记忆、可迁移复用的公式、定理、性质或方法辨析时由模型选择输出；任一 knowledge card 都会在消息结束后嵌入对话，学生可修改内容后选择保存文件夹归档，或连续点击两次“舍弃/确认舍弃”不入库。两种选择都会解除当前阻塞并继续答疑。新库自动创建“默认知识卡片”和“默认题目卡片”两个系统文件夹；已归档知识卡片可再次编辑并通过 `PUT /api/cards/{id}` 保存修改，题目卡片保持只读。

右侧学习卡片库采用文件管理器形态：虚拟根目录下可创建主文件夹，任意文件夹内可继续创建子文件夹；卡片支持复制、剪切后粘贴、直接移动和删除。已归档知识卡片和题目卡片可以在“从卡片库导出”窗口中按目录树浏览、按文件夹批选或逐张选择后导出 PDF。窗口默认全选，并按 `saved_at` 从新到旧排列；选择编号就是打印顺序。排版预设包括 A4 竖版单列、A4 竖版双列和 A4 横版三列，默认双列；导出会打开系统打印面板，选择“另存为 PDF”即可保留 KaTeX 公式与彩色版式。

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
- `docs/session-events.md`：版本化 session event 合同、有限历史 API、`after_seq`/`Last-Event-ID` 续传与 canonical run 生命周期
- `docs/ai-model-config-v0.2.md`：模型配置 API、密钥存储和多模态标记
- `docs/changelog.md`：版本改动记录

`docs/tutoring-agent-mvp-dev-doc-v0.2.md` 仅保留立项时的历史设计基线；出现冲突时，以现行代码、测试和上面的现行说明为准。

一句话理解当前架构：

```txt
POST /api/sessions/start 原子创建 session + 接纳首条普通消息
  -> 文字首发可先由 /api/problem-intake/analyze-text 拆题，再由 /api/sessions/batch-start 原子批量创建
  -> 图片先由 /api/problem-images/detect 检测并由用户编辑题目框，确认后 /api/sessions/image-batch-start 裁剪并批量创建
  -> session_inputs 接纳普通消息 / checkpoint answer / 卡片关闭后继续
  -> SQLite 原子写输入记录与对应 message/checkpoint/card 状态
  -> /api/chat/stream 读取已落库输入并启动生成
  -> SQLite 取完整结构化历史
  -> build_messages 按 system / user / assistant 多轮消息拼 prompt
  -> LLM 产出带 context_status / 语义摘要 / action 的 TutorTurn JSON
  -> 未收齐题目与思路时后端只允许开放提问；ready 后进入正常教学 action
  -> session run 串行门控 + 后端校验 context/action/checkpoint/card + SQLite 业务态与 durable event 原子落库 + 追加诊断日志
  -> SSE 流式推给前端
  -> 前端展示 message / KaTeX 公式 / 可恢复的已作答 checkpoint / 可保存或舍弃的知识卡片
```

## 技术栈

- Frontend: Next.js + React + TypeScript
- Math Rendering: KaTeX（聊天气泡和检查点题干/选项支持 `$...$`、`$$...$$`、`\(...\)`、`\[...\]`）
- Backend: FastAPI
- Local speech input: FunASR + SenseVoiceSmall + 流式 FSMN-VAD（默认 CPU，不限总录音时长，30 秒有界滚动音频缓冲，1.2 秒刷新临时文字，2.5 秒思考停顿窗口）
- Database: SQLite + Alembic（session、durable session_inputs、结构化消息、checkpoint、层级 card_folders、全局 study_cards、session_runs 和可重放 session_events 的权威存储，也是历史恢复来源；启用 foreign keys、WAL 和 busy timeout）
- Run lifecycle: SQLite `session_runs`（run_id、attempt、queued/running/terminal 状态、时间戳和结构化错误）
- Diagnostic Log: JSONL（机器审计）+ Markdown（留白充足的人类阅读版）
- Model API: OpenAI-compatible chat completions + Anthropic Messages（两种协议均支持流式输出与图片输入转换）

## 目录

```txt
apps/api   FastAPI 后端
  app/core/teaching_controller.py    LLM 决策合同 + prompt + 历史组装 + 流式生成编排
  app/core/tutor_turn_parsing.py     TutorTurn 容错解析、清洗与合同校验
  app/core/tutor_turn_policy.py      action/context 后端策略与 wait_for_student 推导
  app/core/streaming.py              增量 JSON message 解析器（打字机）
  app/llm/provider.py                OpenAI-compatible / Anthropic 双协议流式入口
  app/llm/local_demo_provider.py     本地演示模型与教学状态模拟
  app/llm/opencode_free_models.py    OpenCode 免费模型目录、缓存与能力解析
  app/routes/chat.py                 chat SSE 的 HTTP 接入与 run 执行流程
  app/services/session_stream_coordinator.py  同 session 串行、跨 session 并行与显式中断
  app/services/input_acceptance.py   durable 输入接纳兼容门面（按输入类型分派）
  app/routes/problem_intake.py       文字单题/多题检测与结构化拆分
  app/routes/problem_images.py       图片题目框检测、题图识别与裁剪
  app/routes/speech.py               完整 WAV 与 WebSocket 准实时语音 API
  app/services/sensevoice_transcriber.py  SenseVoiceSmall/流式 VAD、串行推理与结果清洗
  app/storage/repositories.py        SessionRepository / ModelProfileRepository 兼容门面
  app/storage/tutor_actions.py       assistant action、checkpoint、card、event 原子事务
  app/storage/session_*_repository.py run、历史恢复等分域仓储实现
  app/storage/session_logger.py      SessionLogger（JSONL + Markdown 诊断记录）
  migrations/                        Alembic schema revision（数据库演进唯一入口）
  app/storage/session_events.py      durable event 写入、并发 seq 与有限历史
apps/web   Next.js 前端
  components/workspace/              主工作区的页头、时间线、侧栏与输入区
  components/MathText.tsx            KaTeX 数学公式渲染
  hooks/useSessionRuntime.ts          session/timeline/workflow 的 React 接线
  hooks/useSpeechInput.ts             麦克风权限、录音生命周期与本地转写接线
  lib/api.ts                          分域 API client 的兼容出口
  lib/api/                            model/session/card/chat 等协议模块
  lib/audio.ts                        浏览器录音重采样与 16 位 PCM WAV 编码
  lib/timeline.ts                     流式消息拼接与事件确定性 reducer
  lib/session-workflow.ts             composer/run/checkpoint/card 互斥状态机
  lib/stream-controller.ts            按 session 保存 AbortController、支持跨 session 并发与定向停止
  lib/stream-protocol.ts              可选 seq/after_seq 事件适配边界
  styles/                              shell/conversation/card/dialog/print 分域样式
  tests/                               前端 reducer、取消和隔离测试
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

面向客户端断线续传的业务事件不读 JSONL，而是使用 SQLite：

```text
GET /api/sessions/{session_id}/events?after_seq=0&limit=100
GET /api/sessions/{session_id}/events/stream?after_seq=0
```

完整合同和最小幂等消费示例见 `docs/session-events.md`。

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
