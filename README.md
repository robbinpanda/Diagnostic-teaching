# Diagnostic Teaching MVP

诊断式数学答疑 MVP：面向初高中数学题，先诊断学生卡点，再用讲解和检查点选择题推进。

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

欲理解产品逻辑、AI 上下文如何拼装、卡点如何诊断与排查，请先读：

- `docs/state-machine.md`：答疑状态机（phase / action / 检查点回传）
- `docs/context-management.md`：AI 上下文管理（history 渲染、检查点回传、SessionLogger jsonl 全量诊断日志、流式 message）
- `docs/changelog.md`：最近改动记录

## 技术栈

- Frontend: Next.js + React + TypeScript
- Backend: FastAPI
- Database: SQLite（业务态主存储）
- Diagnostic Log: JSONL（`logs/sessions/<session_id>.jsonl`，全量诊断回放）
- Model API: OpenAI-compatible chat completions（**已支持流式 stream=true**）

## 目录

```txt
apps/api   FastAPI 后端
  app/core/teaching_controller.py    状态机 + prompt + 流式生成器
  app/core/streaming.py              增量 JSON message 解析器（打字机）
  app/llm/provider.py                流式 chat completions
  app/storage/session_logger.py      SessionLogger（jsonl 全量记录）
apps/web   Next.js 前端
docs       文档
scripts    Windows 启动、关闭、调试脚本
config     模型配置预设示例
```

## 诊断卡点怎么看

跑一次会话后，每个 session 的全量诊断日志写到：

```txt
logs/sessions/<session_id>.jsonl
```

每行一个事件，包含完整 prompt、LLM 原始返回（含 markdown/fence）、是否走 fallback、检查点全选项正误标签、耗时等。SQLite 仍是业务态主存储，JSONL 只写不读，专门用于"看卡点"。

读取示例：

```bat
scripts\inspect-session.cmd sess_xxxxxxxxxxxx
```

详见 `docs/context-management.md`。

## 注意

本地运行数据、日志和 API key 加密文件不会提交到 Git：

```txt
data/
logs/
apps/web/node_modules/
apps/web/.next/
```