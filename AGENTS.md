# 项目协作指南

## 项目定位

这是一个 Windows 优先、本地运行的诊断式数学答疑 MVP。前端是 Next.js，后端是 FastAPI，SQLite 保存可恢复业务态，JSONL/Markdown 仅用于诊断。

## 开发前先读

- 文档入口：`docs/README.md`
- 教学流程：`docs/state-machine.md`
- 上下文与存储：`docs/context-management.md`
- 本地运行：`docs/how-to-run.md`

## 不变量

- 当前教学 action 只有 `ASK_OPEN_QUESTION`、`ASK_MULTIPLE_CHOICE`、`EXPLAIN_LOCAL`、`EXPLAIN_PRINCIPLE`、`RESPOND_TO_CHECKPOINT`、`SUMMARIZE`。
- `wait_for_student` 由后端按 action 推导，不能交给模型自由决定。
- SQLite 是 session 恢复的唯一权威来源；`logs/sessions/` 下的 JSONL 和 Markdown 都是只追加诊断日志。
- Checkpoint 答案由 answer 接口原子写入结构化 `CHECKPOINT_RESPONSE`，前端随后只触发继续生成，不能重复提交同一答案文本。
- 含题图的 session 必须绑定多模态模型，并保留原始 `problem_image_data_url` 供每轮模型调用。
- API key 只能在后端加密存储；不得进入日志、前端持久化或 Git。

## 验证

- 后端：在 `apps/api` 目录运行 `python -m pytest -q`。
- 前端：在 `apps/web` 目录运行 `npm exec tsc -- --noEmit`；涉及构建或路由时再运行 `npm run build`。
- 修改 action、API、环境变量或数据表时，同步更新 `docs/README.md` 指向的对应现行文档；重要行为变化再更新 `docs/changelog.md`。
