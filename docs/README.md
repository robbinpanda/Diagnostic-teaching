# 项目文档导航

本目录把“现行实现合同”和“历史设计资料”分开。开发或排障时先读现行文档；历史资料只解释设计背景，不应覆盖代码、迁移或现行合同。

## 现行文档

| 文档 | 说明 |
|---|---|
| [系统总览](./system-overview.md) | 产品边界、组件职责、端到端主流程和仓库结构 |
| [教学状态机](./state-machine.md) | `TutorTurn`、六种 action、bounded loop 与教学止步线 |
| [上下文管理](./context-management.md) | 输入接纳、模型上下文、session 恢复、run 与诊断日志 |
| [Session 事件](./session-events.md) | durable event 信封、历史 API 与 SSE 断线重放 |
| [数据库](./database.md) | Alembic、核心关系、SQLite 连接设置与备份 |
| [模型配置](./ai-model-config-v0.2.md) | 三类 provider 协议、加密配置、能力探测和模型绑定 |
| [本地运行](./how-to-run.md) | 源码/Docker 启停、环境变量、语音、验证和排障 |
| [Windows 安装](./windows-installer.md) | 安装包构建、数据目录、升级与签名注意事项 |
| [改动记录](./changelog.md) | 当前未发布变更和历史版本行为 |

根目录的 [PRODUCT.md](../PRODUCT.md) 定义产品范围，[DESIGN.md](../DESIGN.md) 记录当前界面与交互合同；二者仍是现行资料。

## 阅读路径

- 第一次了解项目：`README.md` → `system-overview.md` → `state-machine.md`。
- 修改生成或教学行为：`state-machine.md` → `context-management.md` → 后端 `app/core/`。
- 修改恢复、并发或 SSE：`context-management.md` → `session-events.md` → `database.md`。
- 本地运行或排障：`how-to-run.md` → `changelog.md`。
- 修改模型接入：`ai-model-config-v0.2.md` → `context-management.md`。

## 历史与规划资料

以下文档保留设计演进背景，但不是当前实现的权威说明：

- [早期 MVP 开发文档](./tutoring-agent-mvp-dev-doc-v0.2.md)：实现前的 v0.2 方案与旧 API 草案。
- `superpowers/specs/` 与 `superpowers/plans/`：具体 UI/功能迭代的规格和实施计划。

## 文档维护规则

- action、API、环境变量、表结构或恢复语义变化时，同一提交更新对应现行文档。
- README 只保留定位、快速开始和核心不变量；详细流程写入本目录。
- 计划文档应标明历史属性，不把尚未实现的设想写成当前能力。
- 重要行为变化追加到 `changelog.md` 的“未发布”部分。
