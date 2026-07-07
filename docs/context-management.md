# 上下文管理

版本：v0.3
日期：2026-07-07
适用项目：诊断式数学答疑 MVP

本文档说明每轮 LLM 调用喂给模型的 prompt 是怎么拼的、检查点答案怎么进入上下文、SQLite 与 JSONL 各自存什么，以及流式打字机与诊断日志的关系。

## 1. prompt 拼装

入口：`app/core/teaching_controller.py:build_messages(session, history)`。

每轮都是两条消息（OpenAI chat completions 协议）：

```
system: SYSTEM_PROMPT（含 7 条强规则）
user:   题目 + 学生初始思路 + 当前阶段 + 历史对话 + JSON 格式契约
```

历史对话渲染来自 `history`（最多 20 条，按时间正序）。每条历史行的渲染规则见下文 §3。

## 2. history 来源

`SessionRepository.list_messages(session_id, limit=20)`：从 SQLite `messages` 表取最近 20 条按 `created_at` 正序。每条 row 含 `role / content / metadata_json`。

可写入 `messages` 的 role：

| role | 谁写 | 何时 |
|---|---|---|
| `student` | `chat.py` | 学生在输入框发消息（或前端答完检查点回传，v0.3 改为此角色）|
| `assistant` | `chat.py` | LLM 这轮可见 message 经过 sanitize 后入库 |
| `student`（带 metadata） | `chat.py` | 检查点答题：metadata 里带 `checkpoint_answer` 标记，但 role 仍是 `student` |
| `system` | `chat.py` | 答疑启动提示等系统消息 |

**特别注意**：v0.2 及之前的 `student_checkpoint` 角色在 v0.3 已废弃。早期它写进 messages 表后由 `render_history_row` 渲染成 `student_checkpoint: 我选择了...`，对 LLM 语义模糊，常导致模型重复讲同一检查点。新版本选择走标准 `student` 角色，所有进入 AI 上下文的都是学生发言，干净统一。

`checkpoints` 表本身仍独立存储 `selected_option_id / is_correct / elapsed_ms / answered_at`，作为权威答题数据——但这是给"看数据"用，不进 AI 上下文。

## 3. render_history_row

```python
def render_history_row(row):
    role, content = row["role"], row["content"]
    if role == "assistant" and ('```json' in content[:30] or '"phase"' in content[:200]):
        content = recover_tutor_turn_from_raw(content).message
    return f"{role}: {content}"
```

关键点：早期版本会把 LLM 的 raw JSON（含 markdown fence）原样存进 messages，结果 history 里出现一堆 `{"phase":...`。这里做了兜底——如果 assistant 的 content 开头看起来像 JSON，就 recover 出 `.message` 字段再喂回去。v0.3 之后 SQLite 里的 assistant message 已是 sanitize 后的纯中文，这个兜底主要是历史数据兼容。

sanitize 会做：
- 删 markdown code fence
- 去掉结尾的"来检测一下："等引导语
- 保证展示给学生的中文是干净的一段

## 4. 检查点答案如何影响上下文

学生答完一个 checkpoint：

1. 前端 `handleCheckpoint` 调 `POST /api/checkpoints/{id}/answer`
   - 后端只更新 `checkpoints` 表 + `sessions.phase`，**不再写 messages**
   - 同时写一条 `checkpoint_answer` 事件到 JSONL

2. 前端接着 `POST /api/chat/stream`，body 带：
   ```json
   {
     "session_id": "...",
     "message": "我在检查点「若 a1、a5 是方程根，则 a1·a5 等于多少？」选了：C $6$",
     "checkpoint_answer": {
       "checkpoint_id": "chk_...",
       "selected_option_id": "C",
       "is_correct": false,
       "event": "CHECKPOINT_WRONG"
     }
   }
   ```
   - chat.py 把 `message` 入库成 `student` role，metadata 里带 `checkpoint_answer` 标记
   - 下一轮 `build_messages` 渲染历史时，看到的是清爽的 `student: 我在检查点「...」选了：C $6$`

整个 AI 上下文里再也看不到 `student_checkpoint:` 这种语义模糊的非标准角色。

## 5. SQLite vs JSONL 各自存什么

| 信息 | SQLite | JSONL |
|---|---|---|
| 模型配置 + 加密 API key | ✅ `model_profiles` 表 | ❌ |
| 题目 / 学生初始思路 / 当前 phase | ✅ `sessions` 表 | ❌ |
| **AI 对话上下文**（messages，喂给 prompt） | ✅ `messages` 表 | ❌ |
| 检查点权威答题数据 | ✅ `checkpoints` 表 | ❌ |
| LLM 原始 raw（含 markdown/fence） | ❌ 只存净化后 message | ✅ `raw_response` |
| 完整 prompt（system+user） | ❌ | ✅ `prompt_messages` |
| 是否走 fallback | ❌ | ✅ `parse_ok` `used_fallback` |
| checkpoint 完整正误标签 | ❌ 返回前端时被 pop 掉 | ✅ 完整保留 |
| 耗时 / finish_reason / error | ❌ | ✅ |
| `checkpoint_answer` 事件 | 仅 phase 字段写回 sessions | ✅ 完整事件 |

一句话：**SQLite 是跑业务的活状态，JSONL 是只写不读的黑匣子**。

## 6. SessionLogger 详解

文件：`app/storage/session_logger.py`。

落点：`logs/sessions/<session_id>.jsonl`（一行一 JSON 事件，原子 append，崩溃只丢最后半行）。

两个事件类型：

### tutor_turn 事件

```json
{
  "ts": "2026-07-07T07:06:14.811199+00:00",
  "session_id": "sess_...",
  "event": "tutor_turn",
  "model_profile_id": "prof_...",
  "model": "glm-5.2",
  "prompt_messages": [ {system 内容}, {user 内容} ],
  "raw_response": "```json\n{...完整原文...}\n```",
  "parsed_turn": { "phase": "...", "action": "...", "checkpoint": {...完整字段...} },
  "latency_ms": 30294,
  "parse_ok": true,
  "used_fallback": false,
  "error": null
}
```

### checkpoint_answer 事件

```json
{
  "ts": "...",
  "session_id": "sess_...",
  "event": "checkpoint_answer",
  "checkpoint_id": "chk_...",
  "question": "...",
  "selected_option_id": "C",
  "selected_text": "$6$",
  "is_correct": false,
  "misconception": "误用一次项系数",
  "elapsed_ms": 8183,
  "checkpoint_event": "CHECKPOINT_WRONG",
  "next_phase": "recovering"
}
```

安全保证：所有写日志操作都包在 `try/except OSError` 里，**写盘失败绝不影响答疑主流程**。断电、磁盘满、权限拒绝，都不影响学生继续答疑——只是没留下记录。

## 7. 流式打字机如何与上下文管理配合

流式接收细节：

- `app/llm/provider.py:chat_stream_completion`：`stream=true` 调用 LLM，逐 chunk yield `{"delta", "finish_reason"}`
- `app/core/streaming.py:MessageStreamExtractor`：增量 JSON 解析器。一边 consume raw 增量，一边识别 `"message":"..."` 字段的开口；只要进入字段内部，就正确解码 `\n \t \r \" \\ \/ \uXXXX` 转义，把可见字符增量 yield 出来
- `app/core/teaching_controller.py:generate_tutor_turn_stream`：异步生成器，yield `("message_delta", 增量)` × N → 最后 yield `("turn", TutorTurn)`
- `app/routes/chat.py`：把 message_delta 透传成 SSE，turn 完整后再发 decision/checkpoint_ready/message_done

为什么 message 可以边收边发、checkpoint 必须等完整：

- message 字段是 LLM 自己边想边输出的可见讲解，逐字透传对学生体感最好。
- checkpoint 字段有强结构（3 选项正误+误区），必须在 raw 完整后用 `extract_json_object` 解析再 `validate_checkpoint`，避免增量解析碰到半个 JSON 时把脏的片段透出去。
- 同时 `parsed_turn` 在 raw 完整后解析，写回 SQLite 的 `messages.content` 仍是 sanitize 后的纯中文——SQLite 里不会出现半句断裂内容。

## 8. 看卡点的标准流程

学生答完会话断掉了？按这个顺序看：

1. `logs/sessions/<session_id>.jsonl` 找最后一行
   - 如果是 `tutor_turn` 且 `raw_response` 为空、`latency_ms` 接近 timeout → LLM 空响应，已被转 SSE error；下一版会让前端显示"请重试"
   - 如果 `parse_ok=false`、`used_fallback=true` → LLM 返回了但格式坏了，看 `raw_response` 复盘
   - 如果 `error` 非空 → 网络/模型异常
2. 看 `prompt_messages` 当时的 user 段：history 里学生/助手对话是否正确，尤其是检查点答题是否被拼成 `student: 我在检查点「...」选了：...`
3. 看 SQLite `sessions.phase` vs JSONL 里 `checkpoint_answer.next_phase` 是否一致
4. 看 `checkpoints` 表 `selected_option_id / is_correct / elapsed_ms` 是否符合预期
5. 如果 JSONL 多行连续 `tutor_turn` 都返回相同 checkpoint 且都是 `SHOW_CHECKPOINT_MC` → 检查点回传没进上下文（v0.3 应已修复）

## 9. 删/重建会话注意

JSONL 是 append-only，**删 SQLite session 不会清理对应的 `.jsonl`**。如果需要彻底清掉某次实验，手动删 `logs/sessions/<session_id>.jsonl` 即可。`.gitignore` 已忽略整个 `logs/` 目录，不会进 git。