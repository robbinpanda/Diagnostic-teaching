# 上下文、Session 恢复与诊断日志

版本：v0.7

日期：2026-07-13

适用项目：诊断式数学答疑 MVP

本文档说明三件事：模型每轮收到什么，历史 session 如何恢复，以及 SQLite、JSONL、Markdown 日志分别承担什么职责。

## 1. 数据职责

系统有一条权威业务数据线和两种只追加日志：

| 数据 | 职责 | 是否用于恢复 |
|---|---|---|
| SQLite | 保存 session、结构化 messages、checkpoints 和 action 关联 | 是，唯一来源 |
| `<session_id>.jsonl` | 严格的一行一事件机器日志，便于脚本分析和审计 | 否 |
| `<session_id>.log.md` | 与 JSONL 同步写入、留白充足的人类可读时间线 | 否 |

JSONL 不是数据库，也不承担断点续聊。它可能因为日志目录被清理、写盘失败或版本变化而不完整；SQLite 才保存可继续运行所需的关系数据。

## 2. 每轮真正发给模型的消息

入口：

```text
apps/api/app/core/teaching_controller.py
```

核心函数：

```python
build_messages(session, history)
```

发送给 OpenAI-compatible chat completions 的是一个真实多轮数组：

```text
system
user      SESSION_START
user      学生消息
assistant 教学 action
user      学生回答或 checkpoint_result
assistant 教学 action
...
```

历史中的每条 SQLite message 都单独映射成一条 `user` 或 `assistant` 消息，不再把整段历史拼进最后一个大 user prompt。

应用层不再设置“最近 20 条”之类的截断，也不做摘要或压缩。`SessionRepository.list_messages(session_id)` 默认读取该 session 的全部消息并按时间正序发送。

仍需注意：模型服务自身有硬上下文窗口。项目不主动截断，但实际总 token 超过所选模型限制时，供应商仍可能拒绝请求。

### 2.1 system 消息

system 消息由四部分组成：

1. `SYSTEM_PROMPT`：教师角色、教学原则和强规则。

2. `ACTION_PROTOCOL`：像工具说明一样，在第一次及后续每次请求中明确列出每个教学 action 的用途、必需字段、阻塞性和后端行为。

3. `JSON_CONTRACT`：要求模型只返回一个 `TutorTurn` JSON。

4. 当前 action loop 约束：连续非阻塞动作数，以及是否必须转成阻塞动作。

`action` 不是 tool call。它不会操作电脑或调用外部资源，而是教学工作流的控制字段。每条 assistant 消息只能对应一个 action。

### 2.2 SESSION_START

第二条消息固定是 `user` role，其 JSON 内容类似：

```json
{
  "kind": "session_context",
  "message_action": {
    "id": "session_start",
    "type": "SESSION_START",
    "blocking": false
  },
  "grade_band": "junior",
  "subject": "math",
  "problem_text": "题目正文",
  "student_initial_thought": "学生初始思路",
  "current_state_hint": "diagnosing",
  "has_problem_image": false
}
```

如果题目有原图，这条消息使用多模态 content，同时携带文本 JSON 和 `image_url`。

新 session 不再把初始思路重复写成第一条 student message。对旧数据库，若第一条 legacy student message 与初始思路完全相同，`build_messages()` 会跳过该重复项。

### 2.3 历史 message 信封

普通学生回答在模型上下文中类似：

```json
{
  "kind": "student_message",
  "message_action": {
    "id": "act_...",
    "type": "STUDENT_RESPONSE",
    "blocking": false
  },
  "in_reply_to_action_id": "act_上一条阻塞动作",
  "message": "学生输入的内容"
}
```

assistant 教学动作类似：

```json
{
  "kind": "teaching_action",
  "message_action": {
    "id": "act_...",
    "type": "ASK_OPEN_QUESTION",
    "blocking": true
  },
  "message": "你先说说移项后等式变成什么？",
  "state_hint": "diagnosing",
  "wait_for_student": true,
  "breakpoint_description": "学生可能不会移项"
}
```

因此模型既能看到自然语言，也能看到每段内容对应的 action、action_id、阻塞属性和回复关系。

## 3. action 与阻塞

可用教学 action：

| action | 类型 | 后端行为 |
|---|---|---|
| `EXPLAIN_LOCAL` | 非阻塞 | 修复学生当前具体卡点，然后继续请求模型 |
| `EXPLAIN_PRINCIPLE` | 非阻塞 | 系统讲解一个知识原理，然后继续请求模型 |
| `RESPOND_TO_CHECKPOINT` | 非阻塞 | 闭环最近一次检查点答案，给出针对性反馈与情绪支持，然后继续 |
| `ASK_OPEN_QUESTION` | 阻塞 | 停止生成，等待学生自由回答 |
| `ASK_MULTIPLE_CHOICE` | 阻塞 | 创建带诊断选项的 checkpoint，等待学生选择 |
| `SUMMARIZE` | 终止 | 问题或卡点已清楚处理时自然总结并结束本轮，无需额外确认题 |

模型只选择 action。`wait_for_student` 由后端根据 action 强制推导，模型不能自己决定。

每条新 message 都有：

- `action_id`：本条 message 对应动作的唯一 ID。

- `action`：动作类型；学生普通回答是 `STUDENT_RESPONSE`，检查点回答是 `CHECKPOINT_RESPONSE`。

- `in_reply_to_action_id`：学生正在回复的阻塞 action。

本次 action 协议升级前的会话与日志已清空，不再保留旧 action 名称兼容。

## 4. checkpoint 是学生返回的 action 结果

`ASK_MULTIPLE_CHOICE` 对应一个 `checkpoint` 选择题请求，它不是外部工具执行，而是等待学生作答的教学互动。

学生选择后，`POST /api/checkpoints/{checkpoint_id}/answer` 会在一个后端事务链中完成：

1. 校验 checkpoint 属于当前 session、未重复作答、选项存在。

2. 把选择、正误、耗时和答题时间写入 `checkpoints`。

3. 更新 session 的 `state_hint`。

4. 直接写入一条 role=`student`、action=`CHECKPOINT_RESPONSE` 的结构化 message。

5. 用 `in_reply_to_action_id` 指向产生该 checkpoint 的 `ASK_MULTIPLE_CHOICE` action。

6. 在 message metadata 中保存完整 `checkpoint_result`。

下一次 `/api/chat/stream` 不再让前端重新提交同一段学生文字，只读取 SQLite 中已经写好的 result。发给模型的 user 消息类似：

```json
{
  "kind": "checkpoint_result",
  "message_action": {
    "id": "act_...",
    "type": "CHECKPOINT_RESPONSE",
    "blocking": false
  },
  "in_reply_to_action_id": "act_show_checkpoint_...",
  "message": "我在检查点……选了：B ……",
  "checkpoint_result": {
    "checkpoint_id": "chk_...",
    "selected_option_id": "B",
    "selected_text": "……",
    "is_correct": false,
    "misconception": "……",
    "elapsed_ms": 4200,
    "event": "CHECKPOINT_WRONG",
    "next_state_hint": "recovering"
  }
}
```

这就是它与普通 tool result 的关键差别：结果来自学生，而不是电脑或外部工具。

## 5. SQLite session 恢复

前端“历史会话”调用：

```text
GET  /api/sessions/history
POST /api/sessions/restore
```

历史列表直接查询 SQLite，包括题目摘要、模型、message 数、checkpoint 数、状态和更新时间。

恢复不是修改原记录，而是复制出一个新 session：

1. 复制 session 题目、原图、初始思路、状态和卡点。

2. 复制全部 messages 和 checkpoints。

3. 为新副本重新生成 message ID、action ID 和 checkpoint ID。

4. 同步重写 `in_reply_to_action_id`、`source_action_id` 和 metadata 中的 checkpoint 引用。

5. 在新 session 的 `restored_from` 记录来源 ID。

6. 若最后有未回答的 checkpoint，前端恢复后重新显示该 checkpoint；否则恢复对话消息并可继续输入。

这样原始实验记录保持不变，恢复后的新分支也有独立、完整的数据关系。

## 6. 诊断日志

日志目录：

```text
logs/sessions/
```

### 6.1 JSONL：给机器

```text
logs/sessions/<session_id>.jsonl
```

每行是一个完整 JSON event，append-only。主要事件有：

- `session_started`
- `message`
- `tutor_turn`
- `checkpoint_answer`

其中 `tutor_turn` 保存完整 `prompt_messages`、模型 `raw_response`、最终 `parsed_turn`、延迟、解析结果、重试和错误。

JSONL 保持紧凑，不为了人眼阅读插入跨行格式，否则会破坏“一行一事件”的可靠性。

### 6.2 Markdown：给人

```text
logs/sessions/<session_id>.log.md
```

每次写 JSONL 时同步追加 Markdown。每个事件独立成节，system/user/assistant 消息分别显示，prompt、raw、解析 action 和 checkpoint 回答之间都有空行与分隔线。

为避免文件巨大，Markdown 阅读版会省略题图的 base64；原始 JSONL 首次模型调用和 SQLite session 仍保留必要数据。

日志写入失败不会中断教学主流程。也正因如此，日志只能用于诊断，不能作为恢复依据。

## 7. 流式输出

链路：

```text
provider.chat_stream_completion()
  -> MessageStreamExtractor.feed(delta)
  -> generate_tutor_turn_stream()
  -> chat.py SSE
  -> page.tsx runStream()
```

常见事件顺序：

```text
message_delta ...
decision
checkpoint_ready（可选）
message_done
```

只有学生可见的 `message` 字段会增量展示。`state_hint`、`action` 和 `checkpoint` 必须等完整 JSON 到达、校验和后端策略归一化后才通过 `decision` 发出。

## 8. 排查建议

优先直接打开：

```text
logs/sessions/<session_id>.log.md
```

需要脚本分析时再读 `.jsonl`。需要确认业务关系或恢复内容时，运行：

```bat
scripts\inspect-session.cmd sess_xxxxxxxxxxxx
```

反复弹同一 checkpoint 时，重点确认：

1. SQLite 是否已有 `CHECKPOINT_RESPONSE` message。

2. 它的 `in_reply_to_action_id` 是否指向 `ASK_MULTIPLE_CHOICE`。

3. 下一轮 Markdown 日志的 prompt 中是否出现 `checkpoint_result`。

4. 模型是否选择了 `RESPOND_TO_CHECKPOINT` 或合适的恢复动作。
