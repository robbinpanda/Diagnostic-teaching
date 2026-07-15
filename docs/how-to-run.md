# 本地启动与关闭

## 首次安装

启动脚本面向 Windows，并固定使用名为 `ai4edu-tutor` 的 Conda 环境。先安装 Anaconda/Miniconda、Node.js 和 npm，然后在项目根目录执行：

```bat
conda create -n ai4edu-tutor python=3.11
conda run -n ai4edu-tutor python -m pip install -r apps/api/requirements.txt
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

如果页面右侧显示 session id，例如：

```txt
sess_c4052d2538a6
```

打开命令行，进入项目目录：

```bat
cd /d C:\Users\robbinpanda\Desktop\ai4edu\产品验证
```

查看最近 10 个 session：

```bat
scripts\inspect-session.cmd
```

查看某一个 session 的完整过程：

```bat
scripts\inspect-session.cmd sess_c4052d2538a6
```

你重点看三张表：

1. `sessions`：当前阶段、题目、模型。
2. `messages`：学生消息、AI 回复，以及每条消息的 `action_id / action / in_reply_to_action_id`。
3. `checkpoints`：每个检查点的问题、选项、正确答案、学生选择，以及产生它的 `source_action_id`。

页面顶部的“历史会话”也直接读取 SQLite。选择一条历史后，后端会复制出一个新 session 并重建 action/checkpoint 引用；原历史不会被修改。

## 看全量诊断日志（推荐）

SQLite 只存可恢复的业务态和结构化 message，看不到 LLM 原始返回、完整 prompt、是否走 fallback。直接人工排查时推荐先看排版后的 Markdown：

```txt
logs/sessions/<session_id>.log.md
```

需要脚本分析和审计时再看严格 JSONL：

```txt
logs/sessions/<session_id>.jsonl
```

JSONL 每行一个事件；Markdown 把同一批事件按 system/user/assistant、模型 raw、解析 action、checkpoint 回答分节展示，并在段落间保留空行。两者都只写不读，不能用于恢复 session。详见 `docs/context-management.md`。

## 为什么之前会闪退

之前的 `start-dev.cmd` 是后台启动脚本，双击后主窗口会立刻结束，所以看起来像闪退。现在已经改成双击友好模式，会打开两个可见服务窗口。

`run-api.cmd` 和 `run-web.cmd` 是单独启动某一个服务用的脚本。现在如果服务启动失败，窗口也会停住并显示错误。

## 看卡点为什么有时"没反应"

先看 `logs/sessions/<session_id>.jsonl` 的最后一条 `tutor_turn`：

1. `parsed_turn.message` 有内容，但页面没显示：看前端 SSE / `decision.message` 兜底，详见 `docs/state-machine.md`。
2. `raw_response` 为空或 `error` 非空：多半是模型空流、超时或网络异常，前端应显示错误。
3. `parse_ok=false`、`used_fallback=true`：模型返回了坏 JSON，后端已尝试恢复 message。
4. 连续重复同一检查点：检查 history 里是否有 `student: 我在检查点「...」选了：...`。

历史修复与根因记录见 `docs/changelog.md`。当前完整流程说明见 `docs/state-machine.md` 与 `docs/context-management.md`。
