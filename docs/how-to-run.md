# 本地启动与关闭

## 首次安装

启动脚本面向 Windows，并固定使用名为 `ai4edu-tutor` 的 Conda 环境。先安装 Anaconda/Miniconda、Node.js 和 npm，然后在项目根目录执行：

```bat
conda create -n ai4edu-tutor python=3.11
conda run -n ai4edu-tutor python -m pip install -r apps/api/requirements-dev.txt
npm --prefix apps/web install
```

项目不依赖 `.env` 也能使用默认路径。需要改数据库、密钥或 session 日志位置时，再创建本地配置：

```bat
copy .env.example .env
```

可用变量：

| 变量 | 默认值 | 用途 |
|---|---|---|
| `DATABASE_URL` | `sqlite:///./data/app.db` | SQLite 文件位置 |
| `APP_SECRET_PATH` | `./data/app-secret.key` | 模型 API key 的本地加密主密钥 |
| `SESSION_LOG_DIR` | `./logs/sessions` | 每个 session 的 JSONL 与 Markdown 日志目录 |

进程环境变量优先于 `.env`；真实 `.env`、`data/` 和 `logs/` 都已被 Git 忽略。

## 数据库迁移与 Windows 本地行为

后端每次启动都会先执行 Alembic `upgrade head`。新库会直接创建当前 schema；旧版无 `alembic_version` 的数据库会自动建立兼容基线并保留现有 profile、session、message、checkpoint 和 card。首次升级旧库前建议先关闭所有 API 窗口并备份 `data/app.db`，只启动一个后端进程完成迁移。

需要手工检查或升级时，在 `apps/api` 目录运行：

```bat
python -m alembic -c alembic.ini current
python -m alembic -c alembic.ini upgrade head
```

CLI 与应用使用同一套 `DATABASE_URL` / `.env` 路径解析。schema 后续演进只新增 `apps/api/migrations/versions/` revision，不再修改 `database.py` 临时补列。当前迁移链已在可靠性基线之后依次加入 `session_inputs`、`session_events`、`session_runs` 与会话内 `context_status`。

每条应用数据库连接都会设置：

- `foreign_keys=ON`：外键在每条连接上真正生效。
- `journal_mode=WAL` 与 `synchronous=NORMAL`：读请求通常不再阻塞短写入，同时保持适合本地应用的持久性/性能平衡。
- `busy_timeout=5000`：遇到另一个短事务占用写锁时最多等待 5 秒；超过后仍会明确报 `database is locked`，SQLite 依旧只有一个写者。

Windows 上运行期间看到 `app.db-wal` 和 `app.db-shm` 是正常现象，不要单独删除或只复制 `app.db` 做在线备份。需要可靠备份时先关闭 API，让 WAL 正常 checkpoint，再复制数据库文件。数据库应放在本机磁盘，不建议放到网络共享盘或正在同步的云盘目录；WAL 不适合这类文件系统。

## 前端状态验证

前端依赖安装完成后，可单独验证状态 reducer、session 隔离和流取消：

```bat
cd apps\web
npm test
npm exec tsc -- --noEmit
```

手工验证多 session 并发时，可在 session A 发送消息并看到“正在思考”后，直接从左栏新建或打开 session B，再在 B 发起生成。A 的列表项应继续显示“正在思考”，两边互不取消；重新打开 A 时会先显示 SQLite 已提交内容并继续接收其活动流。选择列表项不会自动收起左栏。点击停止只停止当前打开的 session。

验证文字多题时，在新答疑输入框一次粘贴两道带独立题号的题目并发送。当前所选模型应先完成拆题，左栏随后出现两个 session；第一题自动打开，两题可同时显示“正在思考”，每个 session 的首条学生消息与标题只包含自己的题目。同一大题的共享题干和多个小问应保留在一个 session。

验证图片多题时，先选中明确标记“支持上传图片”的多模态模型再上传 PNG/JPEG/WebP。检测完成后必须先出现题目框确认页，不应立即创建 session：点选框后可按 Delete/Backspace 删除，拖动框内可平移，拖动四边或角点可缩放。确认后左栏出现与保留框数量相同的 session；逐一打开时，首条消息展示的图片应只是对应框的裁剪内容，且所有 session 使用同一答疑模型。取消确认不应创建任何 session。

提交代码前还应执行完整工程门禁：

```bat
cd apps\api
python -m ruff check .
python -m pytest -q

cd ..\web
npm run lint
npm run typecheck
npm test
```

GitHub Actions 会在每次 push 和 pull request 时于 Windows runner 上重复执行以上检查。

## 启动

双击：

```txt
scripts/start-dev.cmd
```

它会打开两个常驻窗口：

1. `ai4edu-api`：后端 FastAPI，地址 `http://127.0.0.1:8010`
2. `ai4edu-web`：前端 Next.js，地址 `http://127.0.0.1:3000`

等 `ai4edu-web` 窗口里出现 `Ready` 后，打开：

```txt
http://127.0.0.1:3000
```

如果窗口提示：

```txt
Port 8010 is already in use
Port 3000 is already in use
```

通常说明项目已经启动了，不需要再启动一遍。直接打开：

```txt
http://127.0.0.1:3000
```

如果你想重新启动，先双击 `scripts/stop-dev.cmd`，再双击 `scripts/start-dev.cmd`。

## 关闭

推荐方式：

```txt
双击 scripts/stop-dev.cmd
```

它会关闭本项目占用的两个端口：

1. `3000`
2. `8010`

也可以直接关闭 `ai4edu-api` 和 `ai4edu-web` 两个窗口，或在窗口里按 `Ctrl+C`。

## 查看某个 Session 的过程

右侧区域现在是学习卡片库，不再显示 session id。需要排查时，先打开命令行并进入你的项目目录，例如：

```bat
cd /d "D:\path\to\产品验证"
```

无参数运行脚本，按创建时间倒序查看 10 个 session，并取得要排查的 `session_id`：

```bat
scripts\inspect-session.cmd
```

再查看某一个 session 的完整过程：

```bat
scripts\inspect-session.cmd sess_c4052d2538a6
```

该脚本会自动定位 `ai4edu-tutor` Conda 环境，并读取 `.env` 中自定义的 `DATABASE_URL` 与 `SESSION_LOG_DIR`。

你重点看八张表：

1. `sessions`：`context_status`、当前教学阶段、题目/思路语义摘要、模型与可选原图。
2. `session_inputs`：已可靠接纳的普通消息、checkpoint answer、卡片关闭继续命令，以及幂等键和首次结果。
3. `messages`：学生消息、AI 回复，以及每条消息的 `action_id / action / in_reply_to_action_id`。
4. `checkpoints`：每个检查点的问题、选项、正确答案、学生选择，以及产生它的 `source_action_id`。
5. `card_folders`：卡片目录名称、父目录、系统默认目录标记与默认卡片类型。
6. `study_cards`：全局知识/题目卡片内容、来源 session/action/message、`folder_id`，以及是否已由学生保存归档的 `saved_at`。
7. `session_events`：按 session 严格递增的 durable change feed，用于有限历史、SSE 断线补发和事件顺序排查；它与 JSONL 诊断日志无关。
8. `session_runs`：每次生成的 `run_id / attempt / status`、开始结束时间、最后提交 action 下标和结构化错误。

生成过程中可查询或显式停止当前 session：

```text
GET  /api/sessions/<session_id>/run
POST /api/sessions/<session_id>/interrupt
```

空闲或重复 interrupt 是幂等 no-op。显式中断显示为 `interrupted/explicit_interrupt`；关闭页面或客户端停止读取显示为 `failed/client_disconnected`。服务重启后若看到 `failed/process_restarted`，表示旧进程留下的 queued/running run 已被安全终结，服务不会自动重放 provider 请求；可以在确认已提交消息后重新发起生成。

页面左侧会话栏直接读取 SQLite。点击一条会话会打开原 session，并恢复其 messages、待答 checkpoint 和待归档 card，不会因为查看而复制记录；需要显式创建实验分支时仍可调用 `POST /api/sessions/restore`。

右侧卡片库点击已归档卡片后，会在屏幕右侧打开无暗色遮罩的浮层；浮层外的对话仍可滚动和操作。知识卡片可点“修改内容”编辑，再点“保存修改”通过 `PUT /api/cards/<card_id>` 持久化；题目卡片只读。待归档知识卡片的“舍弃”需要连续点击“舍弃”和“确认舍弃”两次才会生效。

需要重置测试数据时：

1. 在左侧会话栏标题旁点击清空按钮，会删除 SQLite 中的全部会话业务态和全部 session 日志，但保留已归档学习卡片和模型配置。
2. 在右侧学习卡片库点击“清空全部卡片”，会删除全部知识卡片和题目卡片，但保留文件夹、会话与日志。
3. 两个按钮都要求二次确认；答疑正在生成时不能执行。

## 看全量诊断日志（推荐）

SQLite 只存可恢复的业务态和结构化 message，看不到 LLM 原始返回、完整 prompt、是否走 fallback。直接人工排查时推荐先看排版后的 Markdown：

```txt
logs/sessions/<session_id>.log.md
```

需要脚本分析和审计时再看严格 JSONL：

```txt
logs/sessions/<session_id>.jsonl
```

JSONL 每行一个事件；Markdown 把同一批事件按 system/user/assistant、模型 raw、解析 action、checkpoint 回答分节展示，并在段落间保留空行。两者都是只追加诊断数据，不能作为 session 业务恢复来源。详见 `docs/context-management.md`。

## 为什么之前会闪退

之前的 `start-dev.cmd` 是后台启动脚本，双击后主窗口会立刻结束，所以看起来像闪退。现在已经改成双击友好模式，会打开两个可见服务窗口。

`run-api.cmd` 和 `run-web.cmd` 是单独启动某一个服务用的脚本。现在如果服务启动失败，窗口也会停住并显示错误。

## 看卡点为什么有时"没反应"

先看 `logs/sessions/<session_id>.jsonl` 的最后一条 `tutor_turn`：

1. `parsed_turn.message` 有内容，但页面没显示：看前端 SSE / `decision.message` 兜底，详见 `docs/state-machine.md`。
2. `raw_response` 为空或 `error` 非空：多半是模型空流、超时或网络异常，前端应显示错误。
3. `parse_ok=false`、`used_fallback=true`：模型返回了坏 JSON，后端已尝试恢复 message。
4. 连续重复同一检查点：检查 SQLite 是否只有一条 `action=CHECKPOINT_RESPONSE` 的 message；页面应把它渲染为保留原题和选项的已作答 checkpoint，而不是展示内部 `student_message` 文本。
5. 舍弃知识卡片后仍被阻塞：检查是否存在对应的 `CARD_DISMISSED_CONTINUE` 输入和 `card.discarded` event；被舍弃的待归档卡片行应已删除，且不会出现在 `GET /api/cards`。

历史修复与根因记录见 `docs/changelog.md`。当前完整流程说明见 `docs/state-machine.md` 与 `docs/context-management.md`。
