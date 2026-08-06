# 诊断式数学答疑

> Windows 优先、数据留在本机的数学答疑产品：先定位学生真正卡住的地方，再提问、讲解、检查和总结。

[![版本](https://img.shields.io/badge/版本-0.5.0-4c7dff)](https://github.com/robbinpanda/Diagnostic-teaching/releases/tag/v0.5.0)
[![平台](https://img.shields.io/badge/平台-Windows-0078d4)](https://github.com/robbinpanda/Diagnostic-teaching/releases)
[![存储](https://img.shields.io/badge/存储-SQLite-0f80cc)](./docs/database.md)
[![Docker](https://img.shields.io/badge/Docker-可用-2496ed)](./compose.local.yml)

同一套教学核心提供 Windows 安装版、源码模式和 Docker 三种运行方式。它们共用六类教学动作、SQLite 数据结构和恢复机制。

## 三种快速开始

### 方式一：Windows 安装版（推荐普通用户）

1. 从 [GitHub Releases](https://github.com/robbinpanda/Diagnostic-teaching/releases/latest) 下载 `Diagnostic-Teaching-Setup-0.5.0-x64.exe`。
2. 双击安装并启动“诊断式数学答疑”。
3. 添加模型服务，或选择本地演示模式体验流程。

安装版已包含前后端、Python 运行时和语音识别依赖，不要求另装 Node.js、Python、Conda 或 SQLite。SenseVoice 模型在第一次使用麦克风时下载，之后从本机缓存加载。

> **0.4.0 升级提醒：**第一次安装 0.5.0 会永久清空 `%APPDATA%\DiagnosticTeaching`，包括旧 SQLite、会话、卡片、模型配置、API key、WAL/SHM 和诊断日志。需要保留时必须在安装前备份；清理完成后，同版本修复安装不会再次删除 0.5.0 新数据。

安装包当前未做商业代码签名，Windows SmartScreen 可能显示“未知发布者”。请确认下载来源为本仓库 Release。卸载应用本身仍保留 0.5.0 数据。

### 方式二：本地命令行（推荐开发者）

需要 Windows、Miniconda/Anaconda、Node.js 20+ 和 npm。

```powershell
git clone https://github.com/robbinpanda/Diagnostic-teaching.git
cd Diagnostic-teaching
git switch dev/local
conda create -n ai4edu-tutor python=3.11 -y
conda run -n ai4edu-tutor python -m pip install -r apps/api/requirements-dev.txt
npm --prefix apps/web install
.\scripts\start-dev.cmd
```

打开 <http://127.0.0.1:3000>。当前功能和运行说明如下。

当前已支持：文字单题/多题自动拆分、PNG/JPEG/WebP 题图的多题框检测与可编辑裁剪、按题目批量创建独立答疑 session、OpenAI Responses / OpenAI-compatible Chat Completions / Anthropic Messages 三协议加密模型配置、自动同步的 OpenCode 免费模型、可选选项或直接输入原文回应的检查点选择题、跨 session 的全局知识卡片/题目卡片库、按试卷稳定归档的层级卡片文件夹与复制/剪切/移动、基于目录树选择的学习卡片 PDF 多排版导出、SQLite 历史会话与删除、按 session 严格递增的 durable events 与断线重放 SSE，以及 JSONL/Markdown 双份诊断日志。页面采用左侧会话、中央对话、右侧卡片的三栏布局；建会话和会话内回复共用底部输入框，不再把“题目”和“你想到哪一步”拆成两个表单。

SQLite schema 由 Alembic 统一管理。后端启动时自动升级到最新 revision；旧版无 Alembic 标记的数据库会在保留业务数据的前提下建立迁移基线。每条应用连接启用 foreign keys、WAL 与 5 秒 busy timeout，具体约束、备份和 Windows 本地运行行为见 `docs/database.md`。

前端会话运行态由 timeline reducer、互斥 workflow 状态机和按 session 隔离的 stream controller 管理。切换会话或新建答疑只切换当前视图，不会关闭其他 session 的 HTTP 流；多个 session 可以同时生成，同一 session 的新 run 仍只会替换该 session 的旧 run。点击停止只中断当前打开的 session，页面卸载才统一收束所有本地流。每个 chat 事件同时绑定 session id 与本地 run id，后台流不能写入后来打开的 session；重新打开仍在生成的 session 时，页面从 SQLite 快照恢复已提交内容并重新接回该 session 的活动流。高频 `message_delta/message_reset` 没有 durable seq；稳定业务边界由独立的 session-events SSE 提供严格递增的 `seq` 和断线重放。

模型设置支持在同一套供应商 Base URL/API key 下批量添加多个 model name，并按供应商类型固定协议：OpenAI 使用 Responses API，OpenAI-compatible 使用 Chat Completions，Anthropic 使用 Messages API。OpenAI Responses 的成功响应 ID 会随 assistant action 保存到 SQLite，后续轮次通过 `previous_response_id` 续接推理状态；若上游不接受旧 ID，则自动回退到完整历史重放。多个 model name 的连接测试最多四项并行执行，每个模型独立显示成功或失败并设置是否多模态；测试请求以及题图分析、题目框检测、文字拆题和正式答疑都会使用表单当前填写并保存的 temperature，不再用固定值覆盖供应商要求。连接测试同时使用当前 timeout 和 max output tokens。图片能力使用每次随机排列的颜色/图形挑战验证模型是否真正读懂图片，而不是只判断请求是否返回文字。模型选择器会根据名称长度自适应宽度，长名称自动省略，多模态项显示“支持上传图片”；管理模式可复选并原子批量删除自定义配置。推理强度选择器为中文档位保留完整显示空间；学习阶段入口暂从首页输入区移除，底层建会话合同仍保留 `grade_band`，未从其他入口指定时使用默认 `junior`。用户配置显示为“供应商名称 · model name”；OpenCode 托管免费模型显示为 `opencodefree-<model-id>`，由 `models.dev` 目录同步协议与图片能力，且不能手动删除。

教学上下文的前置 intake 已取消；新增的拆题阶段只决定“一段输入要创建几个 session”，不参与教学 action。文字首发先调用 `POST /api/problem-intake/analyze-text`，由当前选定模型返回严格 `problems[]` JSON；单题返回一项，多题返回多个自包含题目，再由 `POST /api/sessions/batch-start` 在同一 SQLite 事务中为每题创建正式 session、写入 `session_inputs` 并保存首条 `STUDENT_RESPONSE`。每个子会话都有稳定 session id 与 `client_message_id`，整批重试不会重复创建。进入正式 session 后，题目和学生思路仍由答疑模型按完整对话语义更新；`context_status=need_problem|need_thought` 时后端强制只允许 `ASK_OPEN_QUESTION`，但不会替换或拼接模型的 `message`，两项明确后进入 `ready`。初始题图轮次若第一次有效输出仍为 `need_problem`，后端会携带同一裁图和定向提示条件重试一次；第二次结果无论是否识别成功都直接进入正常策略与持久化，不再继续重试。

正式 session 的学生输入采用“先接纳、后生成”：普通消息先调用 `POST /api/sessions/{session_id}/inputs`，携带稳定的 `client_message_id`，服务端在一个 SQLite 事务中写入 `session_inputs` 和 `STUDENT_RESPONSE` message；随后 `/api/chat/stream` 只负责读取已落库上下文并生成。首次接纳返回 `201 + accepted`，同 ID 同内容重试返回 `200 + duplicate` 和原始结果，同 ID 不同内容返回 `409 IDEMPOTENCY_KEY_CONFLICT`。旧客户端仍可在 `/api/chat/stream` 中携带 message，后端会先走同一接纳服务。

Checkpoint answer 也进入 `session_inputs`，并由数据库唯一约束保证每个 checkpoint 只成功回答一次。每道选择检查点展示三个诊断选项、“我不知道”和“我想自己输入回答”共五种回复方式；第五项提交学生原文，不伪造选项或正误。提交选项后的 checkpoint 会作为结构化用户作答卡片留在消息时间线，并把正确选择标绿、错误选择标红；重新打开历史会话时从 SQLite checkpoint 与 message metadata 恢复。知识卡片解决后的继续命令使用 `CARD_DISMISSED_CONTINUE`：保存会原子归档最终编辑内容，舍弃则原子记录控制输入并删除待归档卡片。事件重放由 `session_events` 承担，生成中断与重启遗留清理由 `session_runs` 承担，两者不混入输入接纳服务。

左侧会话栏直接从 SQLite 读取；“历史搜题”只作为不可跳转的树标题，下面仍保留可搜索、可展开的“试卷 → 题目”快速树，旧会话显示在“未分类题目”中，“清空全部会话”也只保留在这里。错题相关导航采用“错题库”父级，下设“错题合集”和“错题集”。“错题合集”复用按试卷分组的题目总览与单卷题目页，可跨试卷多选题目并进入 A4 打印预览；“仅保存”或“保存并打印”都会通过 `POST /api/mistake-sets` 把题目文字、题图和来源试卷保存为 SQLite 快照。“错题集”展示所有已保存或打印的快照，点击后打开该错题集的 PDF/打印预览，而不是重新罗列可跳转的 session。合集由真实 `SessionHistoryItem` 派生，在视口宽度 `> 1100px`、`761–1100px` 和 `≤ 760px` 时分别显示 3、2、1 列真实试卷卡片，可同时搜索试卷名和题目名，并按“最近更新”或“名称排序”。历史树与合集中的题目仍通过 `GET /api/sessions/{session_id}` 打开原 session，不会因浏览而复制记录。

当前打开、正在运行或存在并发打开/删除请求的会话不可单条删除，中央不提供手工试卷级删除。删除某试卷的最后一个 session 时，后端在同一 SQLite 事务内同步删除该 `exam_papers` 实体，使它从错题合集、快速树和新建题图的选卷列表中消失；“清空全部会话”也会清空全部试卷。已归档知识卡和题目卡不会随 session 或试卷删除，尚未保存的临时卡片则随来源 session 删除。浏览器记住的活动 session 若已因清空数据库、切换 SQLite 文件或其他窗口删除而不存在，刷新时会自动清理该陈旧引用并回到新题界面，不显示 404；侧栏并发删除产生的失效条目也会自动移除。原有 `POST /api/sessions/restore` 仍保留给需要显式创建实验分支的调用方。

图片可通过回形针选择本地文件，也可直接粘贴到输入框。新建答疑时的第一张图片仍与文字草稿互斥：发送后先调用 `POST /api/problem-images/detect`，由当前多模态模型返回最多 20 个归一化题目框；每个框必须同时覆盖完整题干、该题全部学生演算/草稿/最终答案和批改痕迹。前端支持新增、删除、平移和缩放框；确认时必须选择已有试卷或输入新试卷名称，新试卷由 `POST /api/exam-papers` 创建。得到 `paper_id` 后，前端把原图 Blob、模型/年级、检测阶段、试卷归属、编辑后的框以及稳定 session/message IDs 保存在 IndexedDB，再由 `POST /api/sessions/image-batch-start` 在后端裁剪，并在同一 SQLite 事务中按框创建归属该试卷的独立 session。刷新后可恢复待发送、检测和框选状态；若已进入批量创建阶段，则复用同一 `paper_id` 和稳定 IDs 幂等续交。成功建会话或用户明确取消后才清理草稿。进入正式 session 后，可随时继续粘贴或上传图片，也可同时附带文字说明；这些图片不再触发题目框选，而是随对应 `STUDENT_RESPONSE` 原子写入 SQLite、在历史时间线原位恢复，并按消息顺序作为多模态内容传给该 session 绑定的模型。会话内图片要求该 session 使用支持图片输入的模型。

进入图片题目的答疑会话后，顶部“查看题目”按钮和消息中的题图都可打开全屏查看器。查看器默认适应屏幕，支持滚轮或按钮在 100%—500% 之间缩放、放大后拖动、重置视图，并可通过关闭按钮、Esc 或点击遮罩退出。

每次 `POST /api/chat/stream` 现在都有持久化 `run_id` 和递增 `attempt`，状态依次为 `queued -> running -> completed`，异常或中断则进入 `failed / interrupted`。同一 session 的 run 按进入顺序串行，不同 session 可并行；`GET /api/sessions/{session_id}/run` 可查询活动或最新 run，`POST /api/sessions/{session_id}/interrupt` 会显式取消 provider 请求、指数退避等待和后续 bounded loop，空闲或重复中断是幂等 no-op。浏览器仅停止读取不会伪装成显式中断，而会记录为结构化 `failed/client_disconnected`。provider 的连接失败、超时、HTTP 408/429/5xx 以及 overloaded/unavailable 错误会在 60 秒预算内最多进行 4 次总尝试；优先服从 `retry-after-ms` / `Retry-After`，否则使用带约 20% jitter 的 2/4/8/16 秒指数退避并封顶 30 秒。provider 若完成推理却没有返回任何可见内容，本轮仍会用相同请求透明重试一次；连续两次空响应才把 run 标为可重试失败。每次 provider attempt 的结果、延迟、错误分类、响应阶段和是否已收到内容会进入 turn debug 与诊断日志。

每个浏览器生成意图还会发送稳定 `client_run_id`；`session_id + client_run_id` 在 SQLite 中唯一，响应丢失后重复到达不会启动第二个 provider run。chat SSE 只有在完整 action 与 run 的 `completed` 状态已经提交后才发送 `stream_complete`；前端不再把 `message_done` 或干净 EOF 当作整条流成功。EOF/传输异常后会查询 `/run`：已有 action 则重载 SQLite session，未提交 action且错误可重试时受控续跑一次；仍失败时保留输入并在对应学生消息旁显示“重试本轮”，也允许直接在输入框追加内容发起下一轮。

TutorTurn 的 JSON 合同现在允许最多 3 次总格式尝试（2 次带错误反馈的纠正重试）。文字拆题、题图区域检测和图片内容分析共用同一个结构化 JSON 重试器：语法错误、非对象结果或必需字段类型错误不会第一次就返回 502；它们最多进行 3 次结构化尝试，同时对连接失败、超时、408/429/5xx 和 overloaded/unavailable 复用最多 4 次/60 秒的瞬时故障退避。合法的空题目数组仍进入业务层 422，不会伪装成格式故障。

run 中只有完整解析并通过 SQLite 事务提交的教学 action 才进入会话历史；流式显示到一半的 step 不会写成 assistant message。应用启动时会把上次进程遗留的 `queued/running` run 标为 `failed/process_restarted`，不会静默恢复可能重复的 provider 工作。

AI 正在输出时，学生可以反复点击发送插嘴。前端不会中断当前 run，也不会保存半截 assistant 消息；这些输入按发送顺序进入本地可恢复 outbox，等当前完整输出提交后再依次通过 `session_inputs` 接纳，并只启动一轮后续生成，让模型同时看到全部插嘴内容。原有“打断支线—解决支线—返回原讲解”状态和接口已删除；空输入时的停止按钮仍只执行显式中断。

知识卡片策略为：`EXPLAIN_PRINCIPLE` 必须输出；`EXPLAIN_LOCAL` 一旦讲清了值得脱离本题独立记忆、可迁移复用的公式、定理、性质或方法辨析，也必须输出。题目卡片只由 `SUMMARIZE` 产生，必须保存当前具体题目的完整条件、结构化步骤和最终答案，不能把通用知识点改写成题目卡片；同一道题可以先后各产生一张知识卡和题目卡。所有卡片字段中的变量、上下标、方程、不等式和数学符号都必须放在 `$...$` 或 `$$...$$` 中；后端发现裸写数学表达会要求模型重试，确保卡片库和 PDF 中可由 KaTeX 正确排版。卡片锚定在产生它的 assistant 消息之后，而不是持续追加到时间线底部；用户滚过原位或新消息把原位带出视口后，卡片自动折叠。多张已滚过原位的待处理卡片以单行条目收纳在有高度上限的顶部列表中，点击条目会回到原位并展开。当前待处理卡片以及从卡片架或卡片库打开的归档卡片，在视口宽度 `> 900px` 时整张卡片的非交互区域都可直接拖动，灰色圆点保留为原有装饰；入场、从来源打开与关闭返回仍沿用原有自然衔接动画，消息正文始终保持完整宽度，不再为浮动卡片缩窄或绕排。`≤ 900px` 使用无拖动的安全全宽位置。

卡片出现时输入框仍可使用；学生先发新问题时，当前卡片会原子标记为待处理，但不会阻止后续生成新的知识卡、题目卡或再次 `SUMMARIZE`。稍后保存或舍弃待处理卡片不会额外触发一轮重复续讲。新库自动创建“默认知识卡片”和“默认题目卡片”两个系统文件夹；有试卷归属的新卡默认进入受保护的“按试卷归档 / `<试卷名>`”目录，无试卷归属时仍进入对应类型默认目录。知识卡和题目卡共享这棵目录树；“知识库”中央页面按试卷展示已收纳知识卡，进入试卷后显示知识点。待收纳或已收纳的两类卡片都能重新选择试卷目录，也能在卡片内新建试卷并立即保存到对应受管文件夹。同名试卷删除后重新创建会复用原目录及其中旧卡。已归档知识卡片可再次编辑并通过 `PUT /api/cards/{id}` 保存修改；已归档题目卡片内容保持只读，但归档位置可以修改。

“完全没思路”仍是有效的学生思路状态，会让上下文进入 `ready` 并开始正式教学，但不代表教学目标已经完成，也不构成学生缺少某个具体原理的证据。system prompt 按“上下文门禁—原子动作与止步线—action 决策顺序—可见内容与格式—输出合同”分层：若学生完全不会，先用只推进一个连接的低门槛数学问题，默认优先诊断式选择题；只有真实对话已暴露具体知识缺口后，才使用 `EXPLAIN_LOCAL / EXPLAIN_PRINCIPLE`。`EXPLAIN_PRINCIPLE` 只能用一般字母讲一个原理，不得代入本题数据、产生本题新中间结果或接续第二个原理；`EXPLAIN_LOCAL` 至多得到一个局部步骤的直接结果。讲解后学生尚未亲自应用时，下一 action 优先让学生完成关键判断，不能由连续讲解 action 自动接力解完整题。knowledge card 的推导步骤和题目连接字段也受同一止步线约束，不能作为续解旁路。

右侧学习卡片库采用文件管理器形态：虚拟根目录下可创建主文件夹，任意普通文件夹内可继续创建子文件夹；受管“按试卷归档”根及试卷子目录不可重命名、移动或删除，但其中卡片仍可移入、移出、复制和删除。已归档知识卡片和题目卡片可以在“从卡片库导出”窗口中按目录树浏览、按文件夹批选或逐张选择后导出 PDF。窗口默认全选，并按 `saved_at` 从新到旧排列；选择编号就是打印顺序。排版预设包括 A4 竖版单列、A4 竖版双列和 A4 横版三列，默认双列；导出会打开系统打印面板，选择“另存为 PDF”即可保留 KaTeX 公式与彩色版式。

## 本地启动

首次运行先按 `docs/how-to-run.md` 完成 Conda 环境和前端依赖安装。

双击：

```txt
scripts/start-dev.cmd
```

关闭服务：

```powershell
.\scripts\stop-dev.cmd
```

需要自定义 SQLite、密钥或日志目录时，先执行 `Copy-Item .env.example .env`。完整说明见 [本地运行指南](./docs/how-to-run.md)。

### 方式三：Docker

需要 Docker Desktop，建议使用 WSL2 后端。

轻量核心版不安装语音依赖：

```powershell
git clone https://github.com/robbinpanda/Diagnostic-teaching.git
cd Diagnostic-teaching
git switch dev/local
docker compose -f compose.local.yml up -d --build
```

打开 <http://127.0.0.1:3000>。查看状态：

```powershell
docker compose -f compose.local.yml ps
docker compose -f compose.local.yml logs -f app
```

需要本地语音识别时，改用 CPU 语音版：

```powershell
docker compose -f compose.local.yml -f compose.speech.yml up -d --build
```

停止服务：

```powershell
docker compose -f compose.local.yml -f compose.speech.yml down
```

核心镜像实测约 81 MiB，CPU 语音镜像约 711 MiB。语音版只安装 CPU 版 `torch/torchaudio`，不包含 NVIDIA/CUDA 运行时；模型缓存位于 `runtime/models/`。

## 为什么不是普通聊天机器人

普通问答容易直接给答案，却不一定知道学生卡在哪。本项目把教学过程约束为六种动作：

### 代码结构

```txt
apps/api   FastAPI 后端
  app/core/teaching_controller.py    LLM 决策合同 + prompt + 历史组装 + 流式生成编排
  app/core/tutor_turn_parsing.py     TutorTurn 容错解析、清洗与合同校验
  app/core/tutor_turn_policy.py      action/context 后端策略与 wait_for_student 推导
  app/core/streaming.py              增量 JSON message 解析器（打字机）
  app/llm/provider.py                Responses / Chat Completions / Messages 三协议流式入口
  app/llm/local_demo_provider.py     本地演示模型与教学状态模拟
  app/llm/opencode_free_models.py    OpenCode 免费模型目录、缓存与能力解析
  app/routes/chat.py                 chat SSE 的 HTTP 接入与 run 执行流程
  app/services/session_stream_coordinator.py  同 session 串行、跨 session 并行与显式中断
  app/services/input_acceptance.py   durable 输入接纳兼容门面（按输入类型分派）
  app/routes/problem_intake.py       文字单题/多题检测与结构化拆分
  app/routes/problem_images.py       图片题目框检测、题图识别与裁剪
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
  lib/api.ts                          分域 API client 的兼容出口
  lib/api/                            model/session/card/chat 等协议模块
  lib/timeline.ts                     流式消息拼接与事件确定性 reducer
  lib/session-workflow.ts             composer/run/checkpoint 对话状态机（pending card 独立并行）
  lib/stream-controller.ts            按 session 保存 AbortController、支持跨 session 并发与定向停止
  lib/stream-protocol.ts              可选 seq/after_seq 事件适配边界
  styles/                              shell/conversation/card/dialog/print 分域样式
  tests/                               前端 reducer、取消和隔离测试
docs       文档
scripts    Windows 启动、关闭、调试脚本
config     模型配置预设示例
```

### 六种教学动作

- `ASK_OPEN_QUESTION`：追问缺失信息或学生思路。
- `ASK_MULTIPLE_CHOICE`：用选择题检查关键理解。
- `EXPLAIN_LOCAL`：只修复当前局部卡点。
- `EXPLAIN_PRINCIPLE`：讲清可迁移的原理并生成知识卡片。
- `RESPOND_TO_CHECKPOINT`：只根据答对、答错或“我不知道”提供简短、具体的情绪支持，不解释正误、不纠正误区，也不提供公式、提示或下一步方法；数学反馈和讲解交给后续独立 action。
- `SUMMARIZE`：收束方法、步骤与易错点并生成题目卡片。

模型决定下一步教学动作，后端负责合同校验、等待规则、原子写入、幂等控制和失败兜底。`wait_for_student` 始终由后端按动作推导，不能交给模型自由决定。

## 主要能力

- 文字、图片和本地语音输入；文字/图片多题可拆成独立会话。
- OpenAI Responses、OpenAI-compatible Chat Completions 与 Anthropic Messages 三协议，API key 仅在后端加密保存。
- `none / low / high` 推理强度逐模型探测，不按模型名称猜能力。
- 检查点选择题、知识卡片、题目卡片、文件夹管理和 PDF 导出。
- KaTeX 数学公式、初中/高中教学口径、多会话并行生成。
- SQLite 历史恢复、严格幂等输入、可查询/中断的生成生命周期。
- 刷新页面后恢复未完成请求；已接纳输入不会因断流或刷新丢失。

## 数据可靠性

SQLite 是会话恢复的唯一权威来源。普通消息、检查点答案和卡片继续命令会先以稳定幂等键写入 `session_inputs`，再开始生成；同一会话的生成由 `session_runs` 串行管理。浏览器刷新后，前端会恢复未完成请求并与后端已接纳状态对账。关键写事务遇到 `BUSY/LOCKED` 时会在完整回滚后进行两次有限重放，其他数据库错误不会误重试。

| 运行方式 | SQLite 与密钥 | 诊断日志 | 模型缓存 |
|---|---|---|---|
| 源码 | `data/` | `logs/sessions/` | 系统默认缓存 |
| Docker | `runtime/data/` | `runtime/logs/` | `runtime/models/`（语音版） |
| 安装版 | `%APPDATA%\DiagnosticTeaching\data\` | `%APPDATA%\DiagnosticTeaching\session-logs\` | 用户缓存目录 |

JSONL 和 Markdown 日志只用于诊断，不参与业务恢复。数据库约束、WAL 和备份说明见 [SQLite 说明](./docs/database.md)。

## 架构与目录

```text
浏览器 / Electron
        │
        ▼
Next.js 界面 ── FastAPI ── 教学合同与运行协调器
                            │
               ┌────────────┼────────────┐
               ▼            ▼            ▼
            SQLite       模型 API     SenseVoice
          权威业务态      流式生成      本地语音
```

```text
apps/api/                 FastAPI、教学核心、SQLite、语音识别
apps/web/                 Next.js、会话工作台、卡片与恢复逻辑
apps/desktop/             Electron Windows 桌面壳
docs/                     现行设计、运行和存储文档
scripts/                  Windows 启停、诊断和安装器构建脚本
Dockerfile                核心版/语音版多阶段镜像
compose.local.yml         默认轻量部署
compose.speech.yml        CPU 语音扩展
```

## 配置模型

打开页面右上角模型设置，可添加：

- OpenAI Responses：填写 OpenAI 风格 Base URL、API key 和 model name；文本与题图都请求 `<base_url>/responses`。
- OpenAI-compatible：填写 Base URL、API key 和 model name。
- Anthropic Messages：选择 Anthropic 协议后填写对应地址、密钥和模型。
- 本地演示：无需 Base URL 与 API key，用于离线体验流程，不代表真实模型质量。

题图会发送给所选多模态模型；API key 不会进入前端持久化、诊断日志或 Git。仓库不附带任何个人密钥。

## 开发与验证

```powershell
cd apps\api
python -m ruff check .
python -m pytest -q
cd ..\web
npm run lint
npm run typecheck
npm test
npm run build
```

构建 Windows 0.5.0 安装包：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build-windows-installer.ps1
```

产物位于 `dist/windows/installer/`。构建要求与发布检查见 [Windows 安装包说明](./docs/windows-installer.md)。

## 深入阅读

- [教学状态机与动作合同](./docs/state-machine.md)
- [上下文、幂等与恢复](./docs/context-management.md)
- [SQLite 与迁移](./docs/database.md)
- [Session 事件协议](./docs/session-events.md)
- [本地运行与排错](./docs/how-to-run.md)
- [变更记录](./docs/changelog.md)

早期设计文档仅作历史参考；行为冲突时，以现行代码、测试和上述现行文档为准。
