# SQLite 数据库与 Alembic 迁移

版本：v1.1
日期：2026-07-19

SQLite 是 session 恢复的唯一权威来源。JSONL/Markdown 仍然只是只追加诊断日志，不参与 schema 迁移或业务恢复。

## 1. 迁移入口

schema 的唯一演进入口是：

```text
apps/api/migrations/versions/
```

`Database` 初始化时自动执行 `alembic upgrade head`。`database.py` 只负责选择数据库文件、运行迁移和配置连接，不再用 `_ensure_column` 或运行期 `ALTER TABLE` 演进 schema。

在 `apps/api` 手工检查：

```bat
python -m alembic -c alembic.ini current
python -m alembic -c alembic.ini upgrade head
```

命令行和应用都通过 `load_settings()` 解析项目根目录的 `.env` 与 `DATABASE_URL`。

## 2. 基线与旧库升级

`0001_sqlite_reliability` 同时承担新库基线和旧库兼容升级：

1. 新库直接创建当前五张业务表、索引、外键和删除触发器。
2. 无 `alembic_version` 的旧库按历史列集合读取全部数据，补齐缺失列后重建表。
3. 旧版首次增加多模态列时的兼容行为继续保留：原来使用默认 `max_output_tokens=1200` 的 profile 升级为 8000。
4. 已归档卡片即使来源 session 过去已经删除，仍保留原始 `session_id`；它的活动外键会设为 `NULL`。
5. 完成前运行 `PRAGMA foreign_key_check`。除上述合法的已归档卡片来源外，如果旧库还存在损坏的核心关系，迁移会明确失败，而不会静默删除业务行。

迁移不可安全降级回无约束 schema；需要回退时应停止 API 并恢复升级前备份。

## 3. 核心关系与删除语义

| 子表/列 | 父表 | 删除语义 |
|---|---|---|
| `sessions.model_profile_id` | `model_profiles.id` | `RESTRICT`；profile 的正常删除仍是软删除，历史 session 可继续引用 |
| `session_inputs.session_id` | `sessions.id` | `CASCADE`；输入接纳记录随 session 删除 |
| `messages.session_id` | `sessions.id` | `CASCADE` |
| `checkpoints.session_id` | `sessions.id` | `CASCADE` |
| `session_events.session_id` | `sessions.id` | `CASCADE`；durable change feed 随业务聚合删除 |
| `session_runs.session_id` | `sessions.id` | `CASCADE`；run 生命周期记录随业务聚合删除 |
| `study_cards.live_session_id` | `sessions.id` | `SET NULL` |

`study_cards` 有两个不同职责的 session 字段：

- `session_id`：不可变来源审计文本。即使来源 session 删除，仍保留原 ID。
- `live_session_id`：当前仍存在的活动会话外键。新卡创建时等于 `session_id`。

删除 session 前，`trg_sessions_delete_pending_cards` 会先删除 `saved_at IS NULL` 的待归档卡片；随后外键把已归档卡的 `live_session_id` 设为 `NULL`。所以待确认工作流随会话清理，而已经进入全局卡片库的内容和来源审计继续保留。

必要索引覆盖历史排序、session 子记录查询、阻塞 action 回复查找、待答 checkpoint、活动/全局卡片列表和外键父记录删除检查。

`sessions.context_status` 由 `0005_conversational_context` 增加，取值仅为 `need_problem / need_thought / ready`。它与 `problem_text / student_initial_thought` 都属于 SQLite 权威业务态：模型产出的上下文状态和新语义摘要会与完整 assistant action 同事务提交，刷新或恢复时不从诊断日志重新推断。旧 session 在迁移时默认为 `ready`，保持升级前已进入正式教学的语义。

## 4. 连接可靠性

应用的每条 `sqlite3` 连接都配置：

```text
PRAGMA foreign_keys = ON
PRAGMA journal_mode = WAL
PRAGMA synchronous = NORMAL
PRAGMA busy_timeout = 5000
```

foreign keys 是连接级开关，因此不能只在建库时设置。WAL 是数据库文件的持久模式；`busy_timeout` 则需要每条连接设置。5 秒等待只吸收短暂写锁竞争，不能把 SQLite 变成多写者数据库。

## 5. Windows 运行与备份

- API 运行时同目录可能出现 `app.db-wal`、`app.db-shm`，这是 WAL 的正常伴随文件。
- 备份或手工迁移前关闭所有 API 窗口，等待 WAL checkpoint 后再复制 `app.db`。
- 首次升级旧库只运行一个 API 进程，避免两个启动进程竞争 schema 写锁。
- 数据库放在本机磁盘；不要放到 SMB/NFS 共享盘或实时同步云盘目录，WAL 对跨主机共享文件系统不可靠。
- 如果写锁超过 5 秒仍未释放，调用会报 `database is locked`；应排查长事务或重复启动的后端进程。

## 6. 后续 revision

新增 schema 时，在 `apps/api` 运行：

```bat
python -m alembic -c alembic.ini revision -m "describe change"
```

编辑生成的 revision，分别覆盖新库升级和已有数据回填，再运行全量测试。不要修改已发布基线，也不要恢复 `_ensure_column`。当前迁移链为可靠性基线 → durable `session_inputs` → `session_events` → `session_runs` → conversational `context_status`；后续 schema 继续通过新的 `down_revision` 串成单一迁移链。
