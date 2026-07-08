# 本地启动与关闭

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
2. `messages`：学生消息、AI 回复（注意：检查点答题从 v0.3 起走 `student` 角色，不再用 `student_checkpoint`）。
3. `checkpoints`：每个检查点的问题、选项、正确答案、学生选择。

## 看全量诊断日志（推荐）

SQLite 只存业务态和净化后的可见 message，看不到 LLM 原始返回、完整 prompt、是否走 fallback。看卡点推荐看 JSONL：

```txt
logs/sessions/<session_id>.jsonl
```

每行一个事件，包含完整 prompt、LLM 原始 raw、parsed_turn（含完整 checkpoint 正误标签）、耗时、parse_ok、used_fallback、error 等。详见 `docs/context-management.md`。

如果你想直接看 JSONL 整理成可读时间线，可以用 Python 读它：

```bat
C:\Users\robbinpanda\miniconda3\envs\ai4edu-tutor\python.exe -c "import json,pathlib; [print(json.dumps(json.loads(l),ensure_ascii=False,indent=2)) for l in pathlib.Path('logs/sessions/sess_xxxxxxxxxxxx.jsonl').read_text(encoding='utf-8').splitlines()]"
```

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
