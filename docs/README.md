# 文档导航

这里把“当前系统怎么运行”与“立项时怎么设想”分开，避免旧 API 草案被当成现行实现。

## 现行说明

1. [本地启动与关闭](how-to-run.md)：首次安装、启动脚本、日志查看与常见排查。
2. [答疑状态机与 LLM 主导流程](state-machine.md)：六类教学 action、检查点、知识/题目卡片、后端守门、bounded loop 与 SSE。
3. [上下文、Session 恢复与诊断日志](context-management.md)：模型上下文、SQLite 权威数据、卡片持久化、历史恢复/删除和双份日志。
4. [AI 模型配置说明](ai-model-config-v0.2.md)：模型配置 API、密钥存储、多模态标记与 SQLite 字段。
5. [改动记录](changelog.md)：按版本追溯重要行为变化。

## 历史设计基线

- [开发前文档 v0.2](tutoring-agent-mvp-dev-doc-v0.2.md)：保留产品范围、交互设想和早期 API 草案。
- [开发前文档 v0.1](tutoring-agent-mvp-dev-doc.md)：最初的产品假设与里程碑。

历史设计稿不作为接口或目录的事实来源。出现冲突时，以现行代码、测试和上面的现行说明为准。

## 代码事实来源

| 主题 | 代码入口 |
|---|---|
| 教学 action、prompt 与输出合同 | `apps/api/app/core/teaching_controller.py` |
| API 请求/响应 schema | `apps/api/app/core/schemas.py` |
| Chat、session、checkpoint、card、题图与模型路由 | `apps/api/app/routes/` |
| SQLite schema 与数据关系 | `apps/api/app/storage/database.py`、`repositories.py` |
| 前端 API 与 SSE 事件 | `apps/web/lib/api.ts` |
| 当前行为回归测试 | `apps/api/tests/` |
