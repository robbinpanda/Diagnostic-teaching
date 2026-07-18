# Session 事件合同与可重放 SSE

版本：v1

日期：2026-07-18

本文档定义 SQLite `session_events` 的 durable change feed、有限历史 API 和断线续传 SSE。它提供稳定事件边界，但不把系统改造成纯事件溯源架构：session detail、session_inputs、messages、checkpoints、study_cards 仍是业务快照，SQLite 仍是唯一恢复权威；JSONL/Markdown 继续只承担诊断职责。

## 1. 存储与迁移

迁移文件：

```text
apps/api/migrations/versions/0003_session_events.py
```

应用启动时通过 Alembic `upgrade head` 幂等执行。迁移是纯新增表/索引，不修改旧表，也不要求清库，并通过 `down_revision` 接在 durable input 迁移之后：

```text
session_events
  id          TEXT PRIMARY KEY
  session_id  TEXT NOT NULL
  seq         INTEGER NOT NULL
  type        TEXT NOT NULL
  data_json   TEXT NOT NULL
  created_at  TEXT NOT NULL

UNIQUE(session_id, seq)
INDEX(session_id, seq)
```

`seq` 从 1 开始，仅在同一 session 内有序。写入使用 SQLite writer lock 加单条 `INSERT ... SELECT MAX(seq) + 1` 分配序号，并由唯一约束兜底；多线程或多进程并发写同一数据库时不会为同一 session 分配重复 `seq`。

message/action/checkpoint/card 的业务行和对应事件在同一个 SQLite 事务提交。业务事务回滚时事件一并回滚，事件写失败时业务行也不会单独提交。run 边界由请求级事务追加，`run.completed` 与 `session.idle` 成组写入。

删除一个 session 时同时删除它的 `session_events`；清空全部 session 时同样清空事件。这里的 append-only 指 session 存续期间不可更新、不可覆盖，不改变显式删除整个业务聚合的既有语义。

## 2. 统一事件信封

每条 API/SSE 事件都使用同一个信封：

```json
{
  "schema_version": 1,
  "id": "evt_9d1a...",
  "session_id": "sess_7f2b...",
  "seq": 12,
  "type": "action.completed",
  "data": {},
  "created_at": "2026-07-18T08:00:00+00:00"
}
```

- `id` 是全局事件 ID，用于审计；客户端消费游标使用 session 内的 `seq`。
- `type` 决定 `data` 的具体字段。
- `created_at` 只用于显示和审计，不能代替 `seq` 排序。
- 同一 `seq` 的重放内容和 `id` 保持不变。客户端只应用 `seq > lastAppliedSeq` 的事件即可幂等消费。

### 2.1 v1 事件类型

| type | durable data 的关键字段 | 语义 |
|---|---|---|
| `session.created` | `model_profile_id/state_hint/restored_from` | 新 session 或显式恢复分支已经创建；恢复分支另带 baseline 数量 |
| `run.started` | `run_id/has_student_message` | 一次教学生成请求已经取得 session 单写者资格 |
| `message.completed` | 完整 `content/role/message_id/action_id/action` | 一条完整 student/assistant message 已提交；高频 delta 不落此表 |
| `action.completed` | 完整 `message/action/state_hint/wait_for_student` 及引用 ID | 一个后端归一化后的教学 action 已提交 |
| `checkpoint.ready` | 脱敏后的完整 checkpoint 和来源 action | checkpoint 已创建并等待学生作答；不暴露正确项和误区标签 |
| `checkpoint.completed` | 选择、正误、耗时、下一状态和 student message 引用 | answer 接口已原子保存结果与 `CHECKPOINT_RESPONSE` |
| `card.ready` | 完整 card content 和来源引用 | 待归档 knowledge/problem card 已创建 |
| `card.saved` | `card_id/card_type/saved_at` | 学生已关闭并归档卡片 |
| `error.occurred` | `run_id/code/message` | run 内出现可呈现错误 |
| `run.completed` | `run_id/status/stop_reason/action_count` | run 以 succeeded/failed/cancelled 结束 |
| `session.idle` | `run_id/reason` | 当前 session 已退出生成态 |

一个带新学生输入的正常 checkpoint run，其 durable 顺序示例为：

```text
message.completed        # input API 原子接纳 student message
run.started
message.completed        # assistant 完整消息
action.completed
checkpoint.ready
run.completed
session.idle
```

`message_delta` 和 `message_reset` 仍只从 `POST /api/chat/stream` 实时发送。丢失 delta 不影响恢复，因为最终 `message.completed` 和 `action.completed` 可从 SQLite 重放。

## 3. 有限历史 API

```http
GET /api/sessions/{session_id}/events?after_seq=0&limit=100
```

- `after_seq >= 0`，结果严格为 `seq > after_seq`。
- `limit` 默认 100，最小 1，最大 200，避免一次读取无界历史。
- 结果按 `seq` 升序，且只包含路径中的 session。

```json
{
  "schema_version": 1,
  "session_id": "sess_...",
  "after_seq": 0,
  "next_after_seq": 100,
  "latest_seq": 135,
  "has_more": true,
  "events": []
}
```

当 `has_more=true` 时，用 `next_after_seq` 请求下一页。`latest_seq` 是响应生成时数据库中的最新游标，允许客户端判断自己是否已经追平。

## 4. 可重放 SSE

```http
GET /api/sessions/{session_id}/events/stream?after_seq=42
Accept: text/event-stream
```

也可不传 query，改用标准请求头：

```http
Last-Event-ID: 42
```

若两者同时存在，显式 `after_seq` 优先。连接先按序补发所有 `seq > cursor` 的 durable events，追平后继续轮询 SQLite 并推送新事件；因此服务进程重启或多进程写入不会依赖内存广播。空闲 15 秒发送 SSE comment keep-alive。

每帧格式：

```text
id: 43
event: session_event
data: {"schema_version":1,"id":"evt_...","session_id":"sess_...","seq":43,"type":"message.completed","data":{...},"created_at":"..."}
```

`follow=false` 会在补发当前缺口后关闭，适合一次性同步和测试。

最小幂等消费示例：

```js
let lastAppliedSeq = Number(localStorage.getItem(`session:${sessionId}:seq`) ?? 0);
const source = new EventSource(
  `/api/sessions/${sessionId}/events/stream?after_seq=${lastAppliedSeq}`,
);

source.addEventListener("session_event", (event) => {
  const envelope = JSON.parse(event.data);
  if (envelope.seq <= lastAppliedSeq) return;

  applySessionEvent(envelope); // 按 type 更新本地状态；未知 type 应忽略
  lastAppliedSeq = envelope.seq;
  localStorage.setItem(`session:${sessionId}:seq`, String(lastAppliedSeq));
});
```

本任务不实现前端整体 reducer；示例只固定 cursor 和去重规则。

## 5. 版本策略

- v1 内允许给信封或既有 `data` 增加可选字段；消费者必须忽略未知字段。
- 新增业务事件使用新的 `type`；消费者必须忽略未知 type 并仍推进 `seq`。
- 删除字段、改变字段含义或改变既有类型的数据形状属于不兼容变化，必须提升 `schema_version`，并在过渡期由服务端提供双读或双写策略。
- 不重用已发布的 `type` 表达另一种语义。

旧数据库升级后不会根据 messages/JSONL 伪造过去事件。客户端打开旧 session 或恢复分支时，应先调用 `GET /api/sessions/{session_id}` 取得 SQLite 快照，再从当时的 `latest_seq` 开始跟随事件。`POST /api/sessions/restore` 创建的新分支以 `session.created` 记录来源和已复制 baseline 数量；复制内容仍从 session detail 读取。

## 6. 与 canonical run 生命周期的关系

当前代码在 `POST /api/chat/stream` 入口创建 `session_runs` 权威记录，canonical `run_<id>` 同时用于执行协调、状态查询、中断和事件关联。`run.started/run.completed/error.occurred/session.idle` 与 run 状态变化在同一 SQLite 事务提交。

当前整合遵循以下约束：

1. run 仓储创建 canonical run ID，并把同一个 ID 传给 `record_tutor_action()`；通过独立 input API 接纳的学生消息可以早于 run 提交，旧版 stream 内输入则在 run 取得 session 锁后接纳。
2. run 状态更新与 `run.started/run.completed/error.occurred/session.idle` 在同一 SQLite 事务提交，保留本文件的事件 type 和 data 字段含义。
3. 所有 run 事件复用 `SessionEventRepository.append_in_transaction()` 和同一条 session `seq`，不建立第二套 change feed。
4. 显式 interrupt 将 run 置为 `interrupted`，事件侧以 `run.completed.status=cancelled` 表达终止；客户端断流则保留 `failed/client_disconnected` 语义。
