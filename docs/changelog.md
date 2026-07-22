# 改动记录

按时间倒序，列重要改动与对应的根因/影响。

## Windows 安装包 v0.4.0 — 2026-07-22

### 覆盖安装时升级预置模型

- 桌面端与 FastAPI 对外版本从 0.3.0 升为 0.4.0；保持 `appId` 与 per-user NSIS 安装身份不变，使安装器能识别旧版并覆盖原程序目录。
- 修复旧安装数据库存在时新版预置模型完全跳过的问题：每个新的加密模型快照首次启动时，会更新同一 `provider + model` 的旧 `bundled-personal` 配置、补入新增项，并禁用快照已移除项。
- 合并保留旧 profile ID、所有 session/卡片和用户自建模型；安装包指纹应用后写入独立状态文件，同一快照不会在每次启动时反复覆盖用户后续修改。

## v2.6 — 2026-07-22

### Windows 个人模型预置

- Windows 安装版固定关闭 OpenCode 免费目录刷新，随包免费模型裁剪为 `deepseek-v4-flash-free` 与 `mimo-v2.5-free`。
- 构建脚本新增 Git 忽略的个人模型输入文件：先用现有文字探针和随机图片挑战逐模型检查，再把 API key 加密写入首次安装 SQLite 预置库。
- Electron 仅对没有数据库和密钥的新用户安装预置模型；升级安装保留现有用户数据，不覆盖个人配置。
- 允许显式保留探针暂时失败的模型，并支持对已人工确认的模型设置多模态覆盖；失败项仍记录为 `error`，不会伪装成连接成功。

## v2.5 — 2026-07-21

### 对话内检查点与可编辑知识卡片

- Checkpoint 和待归档学习卡片从全屏遮罩弹窗改为消息时间线内嵌卡片；知识卡片支持修改、保存或二次确认后舍弃，已归档知识卡片支持通过 `PUT /api/cards/{id}` 再次编辑。

### 学习卡片文件夹管理器

- 新增层级 `card_folders` 与 Alembic `0006_card_folders`；默认创建“默认知识卡片”和“默认题目卡片”，旧卡片按类型自动归位，SQLite 继续作为唯一业务权威。
- 右侧卡片库移除“全部/知识/题目”选项框，改为支持主文件夹、任意深度子文件夹、面包屑返回和卡片数量的文件管理器。
- 卡片支持复制、剪切粘贴、直接移动和删除；系统默认目录受保护，普通目录必须为空才能删除，仓储层拒绝同级重名和目录循环。
- knowledge/problem card 保存弹窗新增目录选择；knowledge card 的 `folder_id` 与 `saved_at`、`CARD_DISMISSED_CONTINUE` 在同一事务提交，未选位置时仍由后端落入类型默认目录。
- 导出界面重构为左侧目录树和右侧文件内容区，支持逐张选择或递归选择整个目录，同时保留有序选择和三种 PDF 排版。
- 新增文件夹迁移/API/复制移动/原子保存测试，以及前端目录辅助函数、目录式侧栏和导出视图测试。

### 多题检测、可编辑图片框选与批量 Session

- 新增 `POST /api/problem-intake/analyze-text`：使用当前选定模型判断文字为单题或多题，并返回最多 20 项的严格 `problems[]` JSON；每项保留自包含题目和明确属于该题的学生思路，不解题、不编造上下文。
- 新增 `POST /api/problem-images/detect`：使用选定多模态模型检测整张图片中的独立题目框，统一清洗为归一化坐标并按版面排序；单题也返回一个框。检测提示词把学生过程设为框选的必要组成部分，强制覆盖该题全部演算、草稿、答案和批改痕迹，必要时扩大边界或允许轻微重叠，禁止只紧贴印刷题干。
- 新增图片框选确认页：可进入新增模式在图片上连续拖拽补框；已有框可点选、拖动平移、从四边/四角缩放，并支持删除按钮或 Delete/Backspace；取消不会创建会话。
- 新增 `POST /api/sessions/batch-start` 与 `POST /api/sessions/image-batch-start`。批量接纳复用每个子会话的稳定 session/message 幂等键，并在一个 `BEGIN IMMEDIATE` 事务中创建整批 session；图片接口按最终框在后端裁剪，只把对应裁剪图绑定到各自 session。
- 前端成功建批后打开第一题，同时为所有子 session 并行启动原有答疑 run；其他题立即出现在左栏，继续遵守同 session 串行、跨 session 并行和 `sessionId + runId` 隔离。
- 保留旧的单题 `/api/sessions/start` 与 `/api/problem-images/analyze` 兼容入口；教学 action、`wait_for_student` 推导、SQLite 权威恢复和只追加诊断日志不变。
- 增加文字拆题、图片检测、按框裁剪、批量幂等事务与框选组件回归测试，并用真实页面确认两道文字题会创建两个左栏 session。

## v2.4 — 2026-07-20

### 模型选择器与批量配置管理

- 原生模型下拉改为自适应选择器：当前名称决定自然宽度，视口限制和省略号兜住超长名称，菜单补充供应商主机、选中态和完整名称提示。
- 多模态模型在当前选择与选项中显示“支持上传图片”，上传题图前即可区分图片模型和纯文本模型。
- 选择器新增管理模式，可复选、按接口上限一次选择最多 20 个自定义模型并删除；超过 20 项时可分批选择，OpenCode 托管项只读且不可勾选。
- 修复已有选中模型时新增入口被“编辑”按钮替代的问题；选择器标题区现在把“新增模型”与“管理”并列展示，新增始终打开空白配置弹窗。
- 新增 `POST /api/model-profiles/batch-delete`。后端先在同一 SQLite 写事务中校验全部 ID 和托管状态，再统一软删除；任一项失败时整批回滚。
- 增加批量删除顺序/回滚测试和模型选择器能力提示、管理控件、自适应长名称样式测试。

### Windows 10/11 安装包

- 新增 Electron + NSIS 桌面壳，参考 OpenCode 的 `electron-builder` 结构，以 per-user、无需管理员权限的安装方式生成 x64 安装包、桌面快捷方式和开始菜单入口。
- Next.js 改为静态导出；PyInstaller 把 FastAPI、Python 运行时、Alembic migrations 与图片资源封装为 sidecar。终端用户无需安装 Node.js、Python、Conda 或 SQLite。
- 桌面主进程为每次运行分配随机 `127.0.0.1` 端口，等待健康检查后再显示窗口；单实例运行，退出时通过一次性 token 请求 sidecar 正常停机，超时才强制结束。
- 安装版数据、API key 加密主密钥和日志写入当前用户应用数据目录，升级/卸载默认不删除业务数据。
- 渲染进程关闭 Node 集成、启用 sandbox/CSP、拒绝权限、外部导航和非本机请求；安装版固定关闭 `models.dev` 目录刷新，且不包含登录、遥测或自动更新，默认运行时外网仅由模型连接测试和 LLM 调用产生；普通本地运行仍保持主线的自动目录同步行为。
- 新增 `scripts/build-windows-installer.ps1`、独立桌面依赖、PyInstaller spec、桌面静态服务安全头测试和完整构建/安装文档。

## v2.3 — 2026-07-20

### 多 Session 前台并发与非阻塞图片任务

- 前端 stream controller 从单一活动流改为按 session 保存活动流；切换 session 和新建答疑不再断开旧 SSE，不同 session 可并发生成，同一 session 仍只允许最新本地 run 占用连接。
- “停止生成”改为定向中断当前打开的 session；页面卸载才取消全部本地流。左栏对后台生成中的 session 显示“正在思考”，并只禁止删除对应 session 或在有活动 run 时清空全部会话。
- 会话打开时若该 session 仍有本地活动流，会用 SQLite 快照恢复已提交内容并重新接收后续事件；跨 session 的迟到事件继续由 `sessionId + runId` 隔离。
- 文本建会话、普通消息接纳、checkpoint/card 继续和图片流程的异步回调均绑定原 session/视图身份，切换后不会覆盖新会话状态。
- 题图流程在文件选择时预分配 session 与幂等消息 ID；读图、视觉识别、正式建会话和首轮生成可在后台继续，期间允许新建/打开其他会话和浏览学习卡片。
- 后台 session 在切换视图后才进入生成时，只更新自身时间线与运行标记，不再接管当前会话工作流或锁住当前输入框。
- 点击会话列表项不再自动收起左栏；左栏仅由用户主动收起或初次窄屏布局决定可见性。
- 增加跨 session 同时流式、同 session supersede 和会话运行状态展示测试。

## v2.2 — 2026-07-20

### 模型能力探测与侧栏滚动回归修复

- 修复模型显示名分隔符在 API client 拆分时由 `·` 误写成“路”的回归，并增加精确标签测试。
- 多模态测试改为每次生成随机排列的两组颜色/图形挑战，读取完整模型回复并校验颜色、形状和顺序；文本模型忽略图片后返回 `OK` 不再误判为多模态。图片探测失败会取消多模态勾选；探测预算不再硬编码为 128，而是沿用模型配置并限制在 1024—8192，避免 Kimi 等推理模型在输出可见答案前被截断。
- 同一供应商配置中的多个 model name 由串行测试改为最多四项并行；各行独立完成并即时显示结果，整体耗时不再累加每个模型的完整延迟，同时限制并发数以降低供应商限流风险。
- 修复右侧卡片列表的 CSS Grid 隐式行被压缩、子内容裁剪且不产生滚动高度的问题；会话列表与卡片导出列表同步增加内容行高约束，避免相同布局缺陷复发。
- 增加后端视觉答案真假与分块回复测试，以及前端模型标签和滚动 Grid 样式回归测试。

## v2.1 — 2026-07-19

### 取消前置 intake，改为正式会话内语义收集

- 删除按消息序号把第一条当题目、第二条当思路的 `POST /api/sessions/intake` 流程；寒暄不会再被写成 `problem_text` 或 `student_initial_thought`。
- 新增 `POST /api/sessions/start`：浏览器提供稳定 session id 与 `client_message_id`，服务端在同一 SQLite 事务创建 session、写 `session_inputs`、首条 `STUDENT_RESPONSE` 和 durable events；响应丢失重试返回原会话。
- TutorTurn 新增 `context_status=need_problem|need_thought|ready`、`problem_summary` 与 `student_thought_summary`。模型基于完整对话语义收集上下文，题目和思路可同条、跨多条或逆序提供；“完全没思路”计为有效思路。
- 后端增加最高优先级上下文守门：未 ready 时清除 checkpoint/card，并强制只能 `ASK_OPEN_QUESTION`；ready 后才允许选择题、讲解、总结与卡片。
- 新增 Alembic `0005_conversational_context`，把 `context_status` 纳入 SQLite 权威恢复态；摘要更新与完整 assistant action 原子提交。
- 前端移除 canned intake assistant 消息，首发后立即绑定正式 session；历史会话优先显示已识别题目，尚未识别时显示首条学生消息。
- 增加两个“你好”不填充题目/思路、首发幂等、语义收集、没思路进入 ready、后端 action 守门和迁移测试。

## v2.0 — 2026-07-19

### OpenCode 免费模型与双协议模型调用

- 参考 OpenCode 本地源码的 `models.dev/api.json` 目录和无密钥筛选逻辑，加入 OpenCode 免费模型目录服务：启动后立即刷新、每 60 分钟更新，并在网络失败时使用 `data/opencode-models.json` 或内置快照。
- 当前内置 `big-pickle`、`deepseek-v4-flash-free`、`mimo-v2.5-free`、`north-mini-code-free`、`nemotron-3-ultra-free`；统一显示为 `opencodefree-<model-id>`，以加密的公共凭据 `public` 调用 Zen。
- 免费模型以只读托管 profile 同步到 SQLite，稳定复用 profile ID；目录移除的项仅从可选列表隐藏，历史引用继续保留。PATCH/DELETE 托管项返回 409。
- 目录中的 `modalities.input` 决定 `is_multimodal`。当前只有 `mimo-v2.5-free` 在模型设置里自动勾选“支持图片识别”；下拉和聊天页不增加额外多模态徽标。
- 模型调用层新增 Anthropic Messages 协议：system 顶层转换、data URL 图片块转换、`/messages` 请求头和 SSE 文本/停止事件解析；原 OpenAI-compatible chat completions 流保持兼容。
- 设置弹窗新增 Anthropic Messages 供应商类型；托管免费模型可查看协议和多模态复选框但不能修改，并提示免费端点可能记录输入、不要提交个人或敏感信息。
- 新增目录筛选、协议识别、多模态元数据、托管同步/防修改、Anthropic payload 和 SSE 解析测试。

## v1.9 — 2026-07-18

### Alembic 与 SQLite 可靠性基线

- 引入 Alembic，后端启动自动执行 `upgrade head`；当前五张业务表建立统一迁移基线，旧版无迁移标记的 SQLite 会补齐历史列并保留全部有效业务数据。
- 移除 `database.py` 的内联建表和 `_ensure_column` 演进方式；后续 schema 只通过新的 revision 扩展。
- 每条 SQLite 连接启用 `foreign_keys=ON`、WAL、`synchronous=NORMAL` 和 5 秒 busy timeout，补充 Windows WAL 文件、单写者限制和停机备份说明。
- sessions 到 model_profiles 使用 `RESTRICT`；messages/checkpoints 到 sessions 使用 `CASCADE`。study_cards 新增活动会话外键，数据库触发器删除待归档卡，已归档卡在 session 删除后保留不可变来源审计并继续存在于全局卡片库。
- 新增迁移重复执行、旧库升级、外键拒绝孤儿、索引、级联删除和已归档卡保留测试。

### Durable 输入接纳与幂等提交

- 新增 SQLite `session_inputs` 权威表，区分 `STUDENT_MESSAGE`、`CHECKPOINT_ANSWER` 与 `CARD_DISMISSED_CONTINUE`，并保存幂等键、规范化 payload、首次结果及 message/checkpoint/card 关联。
- 新增 `POST /api/sessions/{session_id}/inputs`：普通消息使用前端生成的 `client_message_id`，第一次返回 `201 accepted`，同值重试返回 `200 duplicate`，同 ID 不同输入返回 `409 IDEMPOTENCY_KEY_CONFLICT`。
- 前端会话消息改成先调用输入接纳接口、成功后再启动 `/api/chat/stream`；同步增加双击锁和失败重试时复用原 `client_message_id`。流接口继续兼容携带 message 的旧调用，但也先经过相同接纳服务。
- Checkpoint answer 改由接纳服务在一个 `BEGIN IMMEDIATE` 事务中写 `session_inputs`、checkpoint 状态、`CHECKPOINT_RESPONSE` message 和 session state；同选项重试返回第一次结果，不同选项重试返回 `409 CHECKPOINT_ANSWER_CONFLICT`。
- 知识卡关闭后的继续改为 durable 控制命令，卡片 `saved_at` 与 `CARD_DISMISSED_CONTINUE` 同事务提交；problem card 仍只归档、不继续。
- 会话详情回传普通消息的 `client_message_id`，显式恢复分支复制并重映射普通消息输入记录；会话删除同时删除所属 `session_inputs`。
- 新增幂等、ID 冲突、并发双击、请求重试、checkpoint 重复提交及强制失败事务回滚测试。

### Session durable events、有限历史与 SSE 续传

- 新增 Alembic `0003_session_events` 迁移：SQLite 保存 append-only `session_events`，以 `(session_id, seq)` 唯一约束和 writer lock 保证并发下严格递增。
- message/action/checkpoint/card 的完成事件与对应业务写入同事务提交；chat run 增加 `run.started/run.completed/error.occurred/session.idle` 边界。高频 `message_delta` 继续只实时发送，完整 message/action 可重放。
- 新增有限历史 `GET /api/sessions/{session_id}/events`，单页最多 200；新增 `GET /api/sessions/{session_id}/events/stream`，支持 `after_seq`、`Last-Event-ID`、先补发后跟随和 keep-alive。
- 固定 `schema_version=1` 信封与类型版本策略；客户端以 `seq` 去重，重复消费不会重复应用状态。
- 旧 SQLite 不伪造过去事件，首次打开仍以 session detail 为基线；JSONL/Markdown 继续仅用于诊断，不能作为 durable event 或恢复来源。
- 新增迁移、并发 seq、事务回滚、分页隔离、顺序、断线续传、重复消费以及 checkpoint/card/error/idle 测试。

### 会话 run 生命周期、显式中断与重启遗留清理

- 新增 Alembic `0004_session_runs` 迁移，持久化 `run_id / session_id / attempt / queued|running|completed|failed|interrupted`、阶段时间戳、最后提交 action 下标与结构化错误。
- `SessionStreamCoordinator` 改为每 session 独立 FIFO 锁：同 session 请求串行，不同 session 并行；可查询 queued/running，并保留当前 provider 子任务用于精确取消。
- 新增 `GET /api/sessions/{session_id}/run` 和 `POST /api/sessions/{session_id}/interrupt`。空闲/重复中断是幂等 no-op；显式中断会先落 `interrupted`，再取消 provider 和后续 bounded loop。
- assistant action、checkpoint、pending card 与 run 状态门闩原子协调：完整提交的 action 保留，半截流式 step 不写 messages；前端停止按钮会调用服务端 interrupt，并移除当前未提交气泡。
- 区分客户端断流与显式中断：前者为 `failed/client_disconnected`，后者为 `interrupted/explicit_interrupt`。应用启动把遗留 queued/running 标为 `failed/process_restarted`，不静默续跑 provider。
- run 生命周期变更与 `run.started/run.completed/error.occurred/session.idle` 事件同事务提交，并复用统一的 `session_events` 顺序和续传协议。
- 新增 run attempt、同/跨 session 并发、重复/空闲中断、生成中中断、完整 action 保留、半截 action 丢弃、异常释放、客户端断流和重启遗留状态测试。

### 前端状态边界、流取消与 session 隔离

- 把 `page.tsx` 中的消息拼接和会话运行态迁到 `useSessionRuntime`、timeline reducer、互斥 workflow reducer 与 stream controller；composer、run、checkpoint、card 不再由多组布尔值自由组合。
- `streamChat` 支持 `AbortSignal`。切换会话、新建答疑和页面卸载会取消旧 fetch；显式停止先请求服务端 interrupt，再收束本地 fetch。所有规范流事件绑定 session id 与本地 run id，迟到的旧流回调无法写入新会话。
- timeline reducer 为 `decision/message_delta/message_reset/checkpoint_ready/card_ready/message_done/run_interrupted/error` 定义重复、reset、终止和迟到规则；已完成 action 不接受后续改写，checkpoint/card first-wins，错误后可启动新 run 恢复。
- 新增可选 SSE `id` / `data.seq` / `after_seq` 适配层。chat 流中的瞬时 delta 目前没有 durable seq，默认请求体保持不变；稳定业务边界通过独立的 session-events SSE 按 seq 续传，无身份 delta 仍按到达顺序处理。
- 新增前端 Node 测试脚本，覆盖 reducer 拼接、重复与迟到事件、session/run 隔离、取消、错误恢复、AbortSignal 透传，以及 legacy/after_seq 请求兼容。

## v1.8 — 2026-07-17

### 同一供应商批量添加模型与多模态自动探测

- 模型配置弹窗支持在一套 Base URL/API key 下通过加号添加多个 model name，后端以事务一次创建多个独立 profile，现有 session 仍绑定具体 profile。
- 每个 model name 独立设置 `is_multimodal`，默认关闭；逐模型测试先验证文本连接，再发送仓库内置视觉样例图。图片请求成功时自动勾选多模态。
- 每行显示测试中的状态、绿色成功勾或红色失败叉；手动声明为多模态但图片探测失败时，整项测试判定失败。
- 前端模型选择和当前模型显示统一为“供应商名称 · model name”，历史会话的模型名称也使用相同格式。
- 移除左侧栏底部与 composer 重复的模型设置入口，避免长模型名挤压侧栏；会话列表和顶部对话标题改用 KaTeX 渲染，并保留完整题目文本以免截断数学定界符。

## v1.7 — 2026-07-17

### 学习卡片混合选择与有序导出

- 卡片库入口从“导出知识卡片”统一为“导出学习卡片”，知识卡片和题目卡片可在同一份 PDF 中混排。
- 打开导出窗口默认全选，并按归档时间从新到旧打印；取消全选后，卡片会按用户点击顺序编号和导出，再次点击取消，重新点击则排到选择序列末尾。
- 题目卡片打印稿新增题目摘要、解题路线、完整步骤、思考提示、坑点和最终答案版式，并以暖色标记和知识卡片区分。
- 保留单列、双列、三列排版及从上到下、再向右续排的多列阅读方式；导出仍然只使用浏览器本地数据和系统打印面板。

## v1.6 — 2026-07-17

### 知识卡片 PDF 多排版导出

- 全局卡片库新增“导出知识卡片”，支持逐张勾选已归档知识卡，不混入题目卡片。
- 新增 A4 竖版单列、A4 竖版双列、A4 横版三列三种预设；默认双列，三列改用横版避免公式列宽过窄。
- 打印稿采用报纸式多列流，先从上到下填满左列再向右流动；普通卡片尽量整张保留，超长单卡只在结构化内容分区之间续排。
- PDF 打印稿复用 `MathText` 与 KaTeX，保留公式、中文内容和卡片层次；导出只读取前端已有数据，不新增 API、不修改 SQLite、不上传外部服务。
- 导出时临时使用“我的数学知识卡片”作为文档标题，并打开系统打印面板供用户选择“另存为 PDF”。

## v1.5 — 2026-07-17

### Codex 风格对话工作台与 session intake

- 页面重构为左侧会话、中央对话、右侧知识卡片的三栏工作台；题目、已有思路、图片和会话内回复统一从底部 composer 发送。
- 新增 `POST /api/sessions/intake`：后端累计并识别题目与学生当前思路，缺哪项就定向追问，两项齐备后才创建正式 session 并进入教学状态机。
- 图片上传下沉为 composer 的小按钮；识别结果进入同一 intake，正式 session 保留用户原图并绑定多模态模型。
- 新增 `GET /api/sessions/{session_id}`，左侧选择会话时直接打开 SQLite 原记录并恢复 pending checkpoint/card；`POST /api/sessions/restore` 继续保留为显式复制分支能力。
- 中小屏默认收起右侧卡片抽屉，手机同时收起左侧会话抽屉；宽屏保持三栏常驻。

## v1.4 — 2026-07-15

### 测试数据一键清理

- 历史会话弹窗新增“清空全部会话”：批量删除 SQLite session/messages/checkpoints、未归档流程卡片和全部 JSONL/Markdown session 日志；已归档全局卡片与模型配置保留。
- 全局卡片库新增“清空全部卡片”：删除全部知识卡片、题目卡片和待归档卡片，但保留会话、消息、checkpoint、日志和模型配置。
- 两个批量接口检测全局活跃答疑流；生成过程中返回 409，避免清空后被并发写回。
- 两项前端操作都有不可逆二次确认，并在成功后同步清理当前页面状态。

## v1.3 — 2026-07-15

### 局部讲解可选知识卡片

- `EXPLAIN_PRINCIPLE` 继续强制输出 `knowledge_card`；`EXPLAIN_LOCAL` 改为由模型按内容的独立记忆和迁移价值决定是否输出。
- prompt 明确适合出卡的内容包括公式、定理、性质和易混方法辨析；一次性代入、算术计算、符号改写或纯本题过渡不出卡，避免卡片库被低价值内容淹没。
- `EXPLAIN_LOCAL` 一旦输出 knowledge card，SSE、弹窗、关闭归档和继续答疑行为与 `EXPLAIN_PRINCIPLE` 一致；不出卡时维持原有非阻塞连续生成。
- assistant 历史上下文会保留 `EXPLAIN_LOCAL` 的可选 card，确保恢复后的模型仍看到完整 `TutorTurn`。

## v1.2 — 2026-07-15

### 全局学习卡片与标题公式渲染

- 已归档学习卡片改为跨 session 的全局卡片库：页面启动即加载，新建、恢复和删除会话都不会清空或复制已归档卡片。
- 卡片仍保留来源 session/action/message 便于审计；尚未关闭的待归档卡片继续绑定原 session，以维持弹窗确认和继续答疑逻辑。
- `GET /api/cards` 和 `DELETE /api/cards/{id}` 不再要求 session id；保存待归档卡片仍需提交来源 session id。
- 知识卡推导标题、题目卡解答步骤标题和右侧卡片列表标题统一使用 `MathText`，修复标题中的 `$...$` 公式原样显示问题。

## v1.1 — 2026-07-15

### 教学 action 标签与视觉录入修正

- 每个 assistant 消息气泡右下角显示本轮教学 action 的中文含义和协议原名；恢复后的历史消息同样显示。
- 图片识别 prompt 要求题目、学生步骤和答案中的数学表达使用 `$...$` / `$$...$$` 合法 KaTeX 格式，避免 OCR 裸公式污染后续显示。
- 要求视觉模型尽量逐行转录清晰可见的学生过程，不再把多步过程压成笼统一句；仍禁止根据题目或答案推测未写出的思维。
- 红笔及其他批改颜色的勾、叉、圈、划线、得分和批语现在必须记录，并由后端合并到“你已经想到哪一步”。若模型给出明确正误但漏写批改描述，后端会补充保守的“可见勾/叉”说明。
- 固化图片识别与答疑隔离边界：正式 session 只接受题目文本、初始思路和可选原始题图，拒绝视觉模型的其他元数据字段；裁剪图仍只用于预览。

## v1.0 — 2026-07-15

### 知识卡片与题目卡片

- `EXPLAIN_PRINCIPLE` 现在必须在 `message` 外结构化输出 `knowledge_card`，包含单一知识点、核心原理、推导步骤、适用场景、常见误区和当前题连接。
- `SUMMARIZE` 现在必须结构化输出 `problem_card`，包含题目摘要、上帝视角解法路线、逐步推理与结果、坑点、步骤来源和最终答案。
- 新增 SQLite `study_cards` 表。生成 action 时先原子写入待归档卡片，学生关闭弹窗后写 `saved_at`；未归档卡片会阻止同 session 绕过弹窗继续生成。
- `EXPLAIN_PRINCIPLE` 保持 `wait_for_student=false`，但 SSE 在 `card_ready` 后暂停；前端关闭并归档 knowledge card 后再继续答疑。`SUMMARIZE` 的 problem card 关闭归档后自然结束。
- 新增 card 查询、保存、删除 API；恢复 session 时复制卡片并重建 card/action/message 引用，尚未关闭的卡片会在恢复后重新弹出。
- 前端以统一卡片组件显示首次弹窗和历史查看；原调试面板改为可滚动、可筛选的卡片库，支持双击查看和删除。

## v0.9 — 2026-07-15

### 教学流程轻量化

- 删除 `DECOMPOSE_STEP`，避免模型先输出整题的上帝视角路线图并被该路线锚定；讲解改为只围绕当前断点选择 `EXPLAIN_LOCAL` 或 `EXPLAIN_PRINCIPLE`。
- 重排 action 决策优先级：先闭环待处理的 checkpoint，能自然收束则直接总结，有明确知识缺口再讲解，只有缺少的信息会影响教学或结论时才提问。
- 降低进入 `SUMMARIZE` 的门槛：学生不必先独立给出最终答案，也不必在总结前额外回答确认性问题。
- 在 `RESPOND_TO_CHECKPOINT.description` 中明确要求提供基于真实表现的情绪价值；答错或选择“我不知道”时降低挫败感，答对时具体认可有效思考。
- local demo 的正确答案链路改为 `RESPOND_TO_CHECKPOINT -> EXPLAIN_LOCAL -> SUMMARIZE`，覆盖无需追加确认题的自然收束。

## v0.8 — 2026-07-13

### 教学 action 协议升级

- `SHOW_CHECKPOINT_MC` 重命名为更直观的 `ASK_MULTIPLE_CHOICE`，并同步后端阻塞策略、SQLite 查询、前端恢复逻辑、local demo 和测试。
- 重写 `SYSTEM_PROMPT`、`ACTION_PROTOCOL` 和每个 action 的 `description / use_when / requires / boundaries`，让 action 名称与实际教学职责严格一致。
- `DECOMPOSE_STEP` 改为从整题全局视角给出 3—6 步解题路线图，不再与局部讲解重叠。
- `EXPLAIN_PRINCIPLE` 负责从定义和原理出发系统讲清一个知识点；`EXPLAIN_LOCAL` 只修复学生当前具体卡点。
- `RESPOND_TO_CHECKPOINT` 只闭环当前待处理的选择结果，后续讲解、提问或总结交给下一 action。
- 选择题回答后的 local demo 链路调整为 `RESPOND_TO_CHECKPOINT -> EXPLAIN_* -> ASK_OPEN_QUESTION`，避免反馈动作夹带新讲解。
- 按协议升级策略清空旧 SQLite 会话、checkpoint 和诊断日志，保留模型配置，不提供旧 action 名称兼容。

## v0.7 — 2026-07-13

### 结构化多轮上下文与 SQLite 恢复

- LLM 输入改为真实的 `system / user / assistant` 多轮 messages；每条历史消息独立发送，不再拼成单个历史文本块。
- 应用层取消固定保留 20 条的限制，不做上下文摘要或压缩。
- system prompt 新增 `ACTION_PROTOCOL`，逐项说明教学 action 的功能、格式、阻塞性和后端行为。
- `messages` 新增 `action_id / action / in_reply_to_action_id`，`checkpoints` 新增 `source_action_id`。
- checkpoint 答案由答题接口直接保存为结构化 `CHECKPOINT_RESPONSE / checkpoint_result`，下一轮不再由前端重复提交。
- 新增 SQLite 历史列表与恢复接口；恢复会复制为新 session，并重建 action/checkpoint 引用关系，JSONL 不参与恢复。

### 人与机器分开的日志

- `<session_id>.jsonl` 保持严格一行一事件，供脚本分析和审计。
- 同步生成 `<session_id>.log.md`，按消息和事件分节、增加空行，供人工直接阅读。
- 日志仍是只追加诊断数据；SQLite 是唯一可恢复的权威状态。

## v0.5 — 2026-07-08

### KaTeX 数学公式渲染

**症状**：AI 回复和检查点中出现 `$a_3$`、`\cdot`、`\frac{}` 等 LaTeX 文本时，前端按普通字符串显示，数学符号不清晰。

**修复**：
- 新增 `apps/web/components/MathText.tsx`
- 引入 `katex` 与 `katex/dist/katex.min.css`
- 聊天气泡、检查点题干、检查点选项统一走 `MathText`
- 支持 `$...$`、`$$...$$`、`\(...\)`、`\[...\]`

**后续注意**：
- 如果希望模型输出更稳定，建议在 `SYSTEM_PROMPT` 或 `JSON_CONTRACT` 中明确“数学公式使用 `$...$` 包裹”。
- 行内公式不要使用 `overflow-x: auto`，否则浏览器会给每个小公式画出迷你滚动条。

### 文档重写：LLM 主导流程

**目的**：方便后续优化教学策略，明确当前系统不是硬编码状态机，而是 LLM 每轮输出 `TutorTurn` 驱动流程。

**更新**：
- `docs/state-machine.md`：重写为“LLM 输出合同 + 后端守门 + 检查点回传 + SSE + 前端呈现”
- `docs/context-management.md`：补充 prompt 拼装、SQLite/JSONL 分工、`decision.message` 兜底、KaTeX 渲染
- `README.md`：补充当前架构和优化入口

## v0.4 — 2026-07-08

### 关键修复：AI 生成了 message 但前端不显示

**症状**：右侧 debug 面板的 `phase/action/breakpoint` 在更新，检查点也会弹出，但聊天区没有显示 AI 说的话。

**根因**：
- 后端只依赖 `message_delta` 做前端展示；如果增量提取器没有提到完整 message，最终解析出的 `TutorTurn.message` 没有补发给前端。
- 前端维护 assistant 气泡时依赖闭包变量，状态更新路径不够稳。
- 某些模型输出 `message` 内部裸引号，例如 `"这道题需要把"函数零点"和..."`，会破坏 JSON 解析。

**修复**：
- `chat.py` 的 `decision` 事件新增 `message` 字段，作为最终兜底。
- `page.tsx` 在收到 `decision.message` 时补齐当前 assistant 气泡。
- `generate_tutor_turn_stream` 记录已发出的 message 片段，最终解析后补齐缺失后缀。
- `teaching_controller.py` 增加对 `message` 内部裸引号的容错修复。
- `provider.py` 对空流、超时、HTTP 异常给出明确 `LlmProviderError`，避免空白无反馈。

**影响**：即使流式增量显示失败，最终 `TutorTurn.message` 仍会显示；模型空响应也会变成可见错误。

## v0.3 — 2026-07-07

### 关键修复：检查点答完"没反应"

**症状**：学生答完检查点后 AI 经常重复讲同一知识点、或又弹同一个检查点、或干脆没反应。

**根因**：
- `apps/web/app/page.tsx` 的 `handleCheckpoint` 答题后调 `runStream(sessionId)` **没传 message**，学生选择只以 `student_checkpoint` 这个非标准 role 写进 SQLite
- `teaching_controller.py:render_history_row` 把它渲染成 `student_checkpoint: 我选择了...`，对 LLM 语义模糊
- prompt 没有任何"学生刚答了你的检查点"的引导，模型丧失对当前进度的判断

**修复**：
- 前端：`handleCheckpoint` 构造 `我在检查点「{q}」选了：{id} {text}` 作为 message 传给 `/chat/stream`
- 前端：`streamChat` 与 `ChatStreamRequest` schema 新增 `checkpoint_answer` 元数据
- 后端：`checkpoints.py` 删掉 `add_message(role="student_checkpoint", ...)`，避免污染历史；选择走标准 `student` role，metadata 里带 `checkpoint_answer` 标记
- 后端：`chat.py` 把 message 写入 student role 时把 `checkpoint_answer` 写进 `metadata_json`
- 后果：AI 上下文里全是干净 `student:` 消息，与手动输入同一条路径

### 放大 bug：local_demo 死循环

`apps/api/app/llm/provider.py:local_demo_response` 早期无视输入永远返回同一份 checkpoint JSON，本地用 local_demo 调试时一定死循环弹窗。改为识别 prompt 末尾"选了：..."，命中则推进到讲解并返回 `checkpoint: null`，专修此死循环。

### 全盘 JSON 会话日志（看卡点）

**痛点**：SQLite 只存净化后的 `turn.message`，丢失 LLM raw 返回、完整 prompt、是否走 fallback、检查点正误标签、耗时——后期"看卡点"无据可查。

**新增**：`apps/api/app/storage/session_logger.py` 提供 `SessionLogger`：
- 落点 `logs/sessions/<session_id>.jsonl`，一行一 JSON 事件，原子 append，崩溃只丢最后半行
- `tutor_turn` 事件：完整 prompt、raw_response（含 markdown/fence）、parsed_turn（**完整保留** checkpoint 的 `is_correct/misconception`）、latency_ms、parse_ok、used_fallback、error
- `checkpoint_answer` 事件：checkpoint_id / selected / is_correct / misconception / elapsed_ms / event / next_phase
- 写盘失败被兜住，绝不影响答疑主流程
- `config.py` 新增 `session_log_dir`（env `SESSION_LOG_DIR`，默认 `logs/sessions/`），`main.py` 注入 `app.state.session_logger`
- `chat.py` 传 logger 给 `generate_tutor_turn`；`checkpoints.py` 写 `checkpoint_answer` 日志
- SQLite 维持业务态主存储，互不干扰

### 真流式打字机 + 空响应抛错

**症状**：某次会话第 7 轮 GLM-5.2 思考 30 秒后返回空字符串，会话静默断流；学生体感是"反应很久然后没字"。

**根因**：
- 旧 `chat_completion` 非流式调用，必须等模型把整段 JSON 全算完才一次性返回
- GLM 带 thinking 的模型先内部推理 20-30 秒不吐 token，httpx 整体 `timeout_ms=30s` 一到就判超时
- 服务端虽算完但连接已断，`data["choices"][0]["message"]["content"]` 返回空串
- 旧代码没检查空 content、没看 finish_reason，静默返回空，外面不动也没报错

**修复**：
- `provider.py` 新增 `chat_stream_completion`：`stream: true` 接 SSE `data:` 行，yield `{"delta", "finish_reason"}`
- httpx read 超时按"两次 chunk 之间"计算而非整体 30s，第一个 token 几百毫秒就能到
- `_assert_nonempty` 把空响应转 `LlmProviderError`：`finish_reason="length"` 提示调大 `max_output_tokens`，其它情况提示"请重试或换一道题"
- `chat.py` 把空响应通过 SSE error 事件透传给前端，不再静默断流
- `provider.py:chat_completion` 重构为复用 streaming 流，向后兼容
- `provider.py:local_demo_stream` 把 local_demo 输出按 4 字一组切，模拟打字机

### 增量 JSON message 解析器

**新增**：`apps/api/app/core/streaming.py:MessageStreamExtractor`
- 流式识别 `"message":"..."` 字段开口后的可见字符
- 正确解码 `\n \t \r \" \\ \/ \uXXXX` 转义
- 跨 chunk 的半个转义（如 `\u4e2` + `d`）暂存等补全，不误吐脏字符
- 只解析 message 字段；结构化的 phase/checkpoint 仍等整段 raw 完整后用 `extract_json_object` 拿，避免边界污染

### teaching_controller 适配流式

`generate_tutor_turn_stream` 异步生成器：yield `("message_delta", 增量)` × N → 最后 yield `("turn", TutorTurn)`。`chat.py` 改用它，去掉旧的"收到完整 message 再切成 18 字一段假流式"逻辑——现在是真打字机。

SYSTEM_PROMPT 加规则 #7「不要在内部做冗长思考，直接产出最终 JSON」，缓解 GLM 长 thinking。

### 测试

- `tests/test_chat_flow.py` 新增：答完检查点 → 第二轮不再弹同一检查点且有可见讲解；UNKNOWN → recovering phase；messages 表不再出现 `student_checkpoint` role；SSE 真流式把 message 切成多段 delta 到达
- `tests/test_session_logger.py`（新增）：raw/fallback/完整 checkpoint 标签 jsonl 记录、checkpoint_answer 事件、多事件 jsonl 追加、写盘失败不抛
- `tests/test_streaming.py`（新增）：message 增量提取、转义引号 + `\u` 解码、跨 chunk 半个转义、local_demo 走流式
- 18 个测试全过，TS 类型检查通过

## v0.2 — 2026-07-07（更早）

初版诊断式教学 MVP：FastAPI + SQLite + Next.js，非流式 LLM 调用，OpenAI-compatible 模型配置加密存储。详见 git 历史。
