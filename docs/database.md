# SQLite 数据库与 Alembic 迁移

版本：v1.5
日期：2026-08-06

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
| `sessions.paper_id` | `exam_papers.id` | `SET NULL`；删除试卷归属时会话仍保留为未分类题目 |
| `exam_papers.card_folder_id` | `card_folders.id` | `RESTRICT`；活动试卷必须绑定稳定的受管卡片目录 |
| `session_inputs.session_id` | `sessions.id` | `CASCADE`；输入接纳记录随 session 删除 |
| `messages.session_id` | `sessions.id` | `CASCADE` |
| `checkpoints.session_id` | `sessions.id` | `CASCADE` |
| `session_events.session_id` | `sessions.id` | `CASCADE`；durable change feed 随业务聚合删除 |
| `session_runs.session_id` | `sessions.id` | `CASCADE`；run 生命周期记录随业务聚合删除 |
| `study_cards.live_session_id` | `sessions.id` | `SET NULL` |
| `study_cards.folder_id` | `card_folders.id` | `RESTRICT`；有卡片的目录不能删除 |
| `card_folders.parent_id` | `card_folders.id` | `RESTRICT`；有子目录的目录不能删除 |

`study_cards` 有两个不同职责的 session 字段：

- `session_id`：不可变来源审计文本。即使来源 session 删除，仍保留原 ID。
- `live_session_id`：当前仍存在的活动会话外键。新卡创建时等于 `session_id`。

删除 session 前，`trg_sessions_delete_pending_cards` 会先删除 `saved_at IS NULL` 的待归档卡片；随后外键把已归档卡的 `live_session_id` 设为 `NULL`。所以待确认工作流随会话清理，而已经进入全局卡片库的内容和来源审计继续保留。

必要索引覆盖历史排序、session 子记录查询、阻塞 action 回复查找、待答 checkpoint、活动/全局卡片列表和外键父记录删除检查。

`0006_card_folders` 新增层级 `card_folders` 和 `study_cards.folder_id`。两个系统默认目录以稳定 ID 建立，升级时所有旧卡片按类型回填目录。普通目录同级名称使用大小写不敏感唯一索引；仓储层同时阻止自引用和把目录移动到自己的后代中。默认目录不能重命名、移动或删除；普通目录仅能在没有子目录且没有卡片时删除。

`0011_exam_papers` 新增 `exam_papers` 和可空的 `sessions.paper_id`。试卷名称使用大小写不敏感唯一索引；重复创建同名试卷返回现有记录，便于图片批量建题失败后安全重试。旧 session 不回填虚构试卷，`paper_id=NULL` 在界面归入“未分类题目”。显式恢复 session 时保留原试卷归属。

`0013_paper_archive_folders` 在 `0012_merge_exam_run_heads` 之后增加受管试卷归档：

- `card_folders.managed_kind` 与 `managed_key` 必须同时为空或同时非空；受管类型仅有 `paper_archive_root` 和 `paper_archive`，非空 key 使用大小写不敏感的条件唯一索引。
- 根目录显示名为“按试卷归档”，稳定身份是 `paper-archive-root:v1`；每份试卷子目录的 key 为 `paper-archive:v1:` 加清理后的试卷名，仅把 ASCII `A-Z` 映射为 `a-z`，与 `exam_papers(name COLLATE NOCASE)` 的身份语义一致。运行时代码按 key 查找，不依赖固定 folder ID。
- 若升级前已有同名普通根或根下同名普通子目录，迁移原位认领并保留其 ID、卡片和子目录。受管根/子目录不可重命名、移动或删除，但卡片仍可移入、移出、复制和删除；删除试卷不清理受管目录。
- `exam_papers.card_folder_id` 是非空外键并带唯一索引。同名试卷删除后重建会获得新的 paper ID，但复用原 card folder ID 和其中旧卡；并发创建同名试卷仍只产生一个活动试卷与一个受管目录。
- 升级时只把仍可由 `live_session_id -> sessions.paper_id` 关联、且仍位于对应类型系统默认目录的旧卡片回填到试卷目录；用户自建目录卡片和来源不可恢复的卡片保持原位。发生回填时同步更新匹配的稳定 `card.ready.folder_id`，并在升级、降级结束前执行 `PRAGMA foreign_key_check`。

单会话删除使用 `BEGIN IMMEDIATE`：先读取准确 `paper_id` 并在数据库内复查 queued/running run，再删除 session；若该 ID 已无其他 session 引用，同一事务删除 `exam_papers`。显式创建但尚无 session 的新试卷不会被全局扫描删除。批量清空会话则在同一事务删除全部 sessions 和全部 `exam_papers`；两种路径都保留受管目录与已归档卡片，只让 session 触发器删除 `saved_at IS NULL` 的临时卡片。普通创建、批量创建和 restore 都在自己的写事务内重新验证 `paper_id`，避免与最后会话删除交错时产生悬空引用。

`0007_reasoning_effort` 为 `model_profiles` 新增非空 `reasoning_effort`，`0008_reasoning_effort_levels` 曾扩展为四档。`0009_reasoning_effort_protocol_probe` 将现行档位统一为 `none / low / high`，把旧 `minimal` 迁为 `none`、旧 `auto / medium` 迁为默认 `low`，并新增非空 `reasoning_effort_options_json`。该 JSON 数组保存完整 profile 实测成功的档位；未测试配置默认 `["none","low","high"]`。请求字段只按供应商类型绑定的协议决定：OpenAI Responses 使用 `reasoning.effort`，OpenAI-compatible Chat Completions 使用 `reasoning_effort`，Anthropic Messages 使用 `output_config.effort`，不再根据 Host 或模型名猜测。

`sessions.context_status` 由 `0005_conversational_context` 增加，取值仅为 `need_problem / need_thought / ready`。它与 `problem_text / student_initial_thought` 都属于 SQLite 权威业务态：模型产出的上下文状态和新语义摘要会与完整 assistant action 同事务提交，刷新或恢复时不从诊断日志重新推断。旧 session 在迁移时默认为 `ready`，保持升级前已进入正式教学的语义。

`0007_checkpoint_free_text` 为 `checkpoints` 增加 `free_text_response`。学生用文字回应待答 checkpoint 时，原文与 `answered_at`、普通学生 message、durable input/event 在同一事务提交；`selected_option_id/is_correct` 保持 `NULL`，用于区分自由表达和选项判定。

`0008_nonblocking_cards` 为 `study_cards` 增加 `deferred_at`。学生在待确认卡片出现后发送新问题时，普通学生 message、durable input、`card.deferred` event 与卡片暂存时间在同一事务提交；`saved_at` 仍为 `NULL`，因此卡片尚未进入卡片库，刷新后仍可继续处理。

## 4. 连接可靠性

应用的每条 `sqlite3` 连接都配置：

```text
PRAGMA foreign_keys = ON
PRAGMA journal_mode = WAL
PRAGMA synchronous = NORMAL
PRAGMA busy_timeout = 5000
```

foreign keys 是连接级开关，因此不能只在建库时设置。WAL 是数据库文件的持久模式；`busy_timeout` 则需要每条连接设置。5 秒等待只吸收短暂写锁竞争，不能把 SQLite 变成多写者数据库。

关键写操作在 `busy_timeout` 之后还提供两次有限重放（等待 50ms、150ms），覆盖首条/后续学生输入、checkpoint、卡片继续命令、run 生命周期、独立 session event 追加和完整 assistant action 提交。重放边界是整个仓储/接纳操作：原连接上下文先回滚整笔事务，再从事务开头执行；不会只重跑失败的单条 SQL，也不会把一个业务提交拆成多次 commit。`session_id / client_message_id / client_run_id` 等请求级稳定键保持不变，因此响应丢失后的客户端重试和数据库锁竞争后的服务端重放仍落在同一个幂等结果上。

仅 `SQLITE_BUSY / SQLITE_LOCKED`（含 Python 对应的 locked 文本）可触发该策略。约束冲突、SQL 错误、数据校验失败和业务异常立即返回，避免把确定性错误伪装成瞬时拥挤。两次重放耗尽后保留原 `OperationalError`，由请求/run 错误边界显式记录和暴露，不会宣称写入成功。

## 5. Windows 运行与备份

- API 运行时同目录可能出现 `app.db-wal`、`app.db-shm`，这是 WAL 的正常伴随文件。
- 备份或手工迁移前关闭所有 API 窗口，等待 WAL checkpoint 后再复制 `app.db`。
- 首次升级旧库只运行一个 API 进程，避免两个启动进程竞争 schema 写锁。
- 数据库放在本机磁盘；不要放到 SMB/NFS 共享盘或实时同步云盘目录，WAL 对跨主机共享文件系统不可靠。
- 如果 5 秒锁等待和两次有限事务重放仍耗尽，调用会报 `database is locked`；应排查长事务或重复启动的后端进程。

## 6. 后续 revision

新增 schema 时，在 `apps/api` 运行：

```bat
python -m alembic -c alembic.ini revision -m "describe change"
```

编辑生成的 revision，分别覆盖新库升级和已有数据回填，再运行全量测试。不要修改已发布基线，也不要恢复 `_ensure_column`。当前迁移链在层级 `card_folders` 后分为两条兼容分支：checkpoint free text → nonblocking cards，以及 reasoning effort → reasoning effort levels → protocol probe；`0010_merge_feature_heads` 先将这两条迁移头合并。其后并行产生 `0011_exam_papers`（新增试卷归属）与 `0011_client_run_id`（为 `session_runs` 增加稳定客户端生成身份和 `(session_id, client_run_id)` 唯一索引），再由 `0012_merge_exam_run_heads` 合并二者；`0013_paper_archive_folders` 在此基础上增加稳定受管目录和 `exam_papers.card_folder_id`。后续 schema 应以 `0013_paper_archive_folders` 为 `down_revision`。
