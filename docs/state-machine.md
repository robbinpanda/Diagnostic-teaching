# 答疑状态机

版本：v0.3
日期：2026-07-07
适用项目：诊断式数学答疑 MVP

本文档说明 AI 答疑每轮的决策模型：`phase`（教学阶段）与 `action`（动作）如何配合检查点推进，以及检查点答案如何回传影响下一步。

## 1. 一轮答疑的结构

学生每发一条消息（或答完一个检查点），后端都会调用一次 LLM，让模型输出一个结构化 JSON 决策：

```json
{
  "phase": "diagnosing|scaffolding|explaining|checking|recovering|summarizing",
  "action": "ASK_OPEN_QUESTION|SHOW_CHECKPOINT_MC|DECOMPOSE_STEP|EXPLAIN_LOCAL|EXPLAIN_PRINCIPLE|RESPOND_TO_CHECKPOINT|SUMMARIZE",
  "message": "给学生看的中文内容",
  "breakpoint_description": "当前卡点，可为 null",
  "breakpoint_confidence": 0.0,
  "checkpoint": null 或 { "...": "见下" },
  "debug": {}
}
```

`message` 是立刻展示给学生的可见讲解/提问，`checkpoint` 一旦存在就会被前端弹成模态选择题。这两个字段是产品体感的核心。

## 2. phase 语义

| phase | 含义 | AI 通常在做什么 |
|---|---|---|
| `diagnosing` | 诊断阶段 | 通过开放问题探测学生卡点 |
| `scaffolding` | 脚手架 | 拆解步骤，逐步推进 |
| `explaining` | 讲解 | 解释当前局部知识 |
| `checking` | 检测理解 | 生成检查点选择题 |
| `recovering` | 兜底 | 学生答错或选"我不知道"，降难度或讲原理 |
| `summarizing` | 收尾 | 串起整道题 |

phase 由 LLM 在 JSON 里自己决定，并由后端 `update_phase` 写回 `sessions` 表的 `phase` 字段，供 debug 面板展示。下一轮 prompt 里会把"当前阶段：{phase}"喂回去，让模型保持连续性。

## 3. action 与前端表现

| action | 前端可见表现 |
|---|---|
| `ASK_OPEN_QUESTION` | 只发 message，等学生输入 |
| `SHOW_CHECKPOINT_MC` | 发 message + 弹检查点选择题模态框 |
| `DECOMPOSE_STEP` | message 里说明要拆成几步 |
| `EXPLAIN_LOCAL` | message 里讲当前一个小点 |
| `EXPLAIN_PRINCIPLE` | message 里讲相关原理/定理 |
| `RESPOND_TO_CHECKPOINT` | 针对学生刚答的检查点给反馈 |
| `SUMMARIZE` | message 串讲结论 |

注意：如果 LLM 返回了 `checkpoint`，但 checkpoint 通不过 `validate_checkpoint`（选项不是 3 个/不恰好 1 正/误区缺失/问题太元认知），后端会**移除该 checkpoint 并把 action 降级成 `EXPLAIN_LOCAL`**，标 `debug.checkpoint_removed=true`。所以前端绝不会收到一个不合法的检查点。

## 4. 检查点回传（关键）

学生答完检查点后，前端 `handleCheckpoint` 走两步：

1. `POST /api/checkpoints/{id}/answer`：把 `selected_option_id`、`elapsed_ms` 写进 `checkpoints` 表，更新 session phase（CHECKPOINT_CORRECT→`scaffolding`，CHECKPOINT_WRONG / CHECKPOINT_UNKNOWN→`recovering`）。
2. `POST /api/chat/stream` 带 `message="我在检查点「{question}」选了：{id} {text}"`：把选择**作为一条普通 student 消息**进入 AI 上下文。

第二步是 v0.3 的关键修复。早期版本只在第一步把答案写进 SQLite 的 `student_checkpoint` 角色，但这条历史对 LLM 语义模糊，导致模型经常重复讲同一个检查点、重复弹同一个检查点、或返回空 message——表现就是"问完检查点就没反应"。v0.3 起选择走标准 `student` 角色，和手动文本输入走同一条路径，AI 一直能拿到"学生刚刚答了什么"的清晰信号。

## 5. 检查点 JSON 结构

```json
{
  "type": "checkpoint_mc",
  "question": "和当前题目强相关的小问题",
  "options": [
    {"id": "A", "text": "...", "is_correct": true, "misconception": null},
    {"id": "B", "text": "...", "is_correct": false, "misconception": "常见误区描述"},
    {"id": "C", "text": "...", "is_correct": false, "misconception": "常见误区描述"}
  ],
  "unknown_option": {"id": "UNKNOWN", "text": "我不知道"},
  "tested_point": "这个检查点测试的知识点",
  "difficulty": "easy"
}
```

`validate_checkpoint` 强约束：
- 必须恰好 3 个 options，恰好 1 正 2 错
- 错误选项必须带 `misconception`（错误对应的常见误区）
- `question` 不能是"你懂了吗/听懂了吗/跟上了吗"这类元认知问题

后端返回前端的 `checkpoint_ready` SSE 事件会**裁掉** `is_correct` 与 `misconception`（避免学生从 devtools 看到答案），但完整字段会留在 `logs/sessions/*.jsonl` 诊断日志里供回放。

## 6. 流式打字机（v0.3 新增）

`/api/chat/stream` 现在用 `stream=true` 调用 LLM。LLM 一边吐 token，后端一边把 `"message":"..."` 字段的可见字符透传成 SSE `message_delta` 事件——学生看到真打字机。

顺序：

```txt
message_delta  × N  ← 边收 LLM 边透传
decision         ← turn 解析完，发 phase/action/breakpoint
checkpoint_ready ← 若有合法 checkpoint
message_done
```

注意 `decision` 现在是在 `message_delta` 之后发——因为流式下我们边收 token 边发，phase/action 要等整段 raw 完整后才能解析。前端按需更新调试面板即可。

为什么能这么换：旧的非流式是先 `decision` 后塞 18 字段假流式；现在真流式优先让用户看到字，结果性元数据延后几百毫秒但体感更好。

## 7. 空响应的处理（v0.3 新增）

非流式时代，LLM 长 thinking 30 秒不吐 token 会被整体 `timeout_ms=30s` 判超时，服务端返回空 content，旧代码静默吞掉——表现就是"没反应"。v0.3 起两道防线：

1. `chat_stream_completion` 用 SSE 流式：read 超时按"两次 chunk 之间"计算，第一个 token 几百毫秒就能到，不再卡整体 30 秒。
2. `_assert_nonempty` 把空响应转成 `LlmProviderError`，由 chat 路由转成 SSE `error` 事件——前端收到明确报错"模型没返回内容，请重试或换一道题"，而不是静默断流。`finish_reason="length"` 还会提示调大 `max_output_tokens`。

## 8. 兼容：local_demo

`provider="local_demo"` 是本地演示模型，不调真实 API。它也走流式接口（按 4 字一组模拟打字），并且会识别学生刚答题（prompt 末尾 "选了：..."）后推进到讲解而非再弹同一检查点——专门修了早期 local_demo 的死循环。

## 9. SYSTEM_PROMPT 强规则

```
1. 检测跟上时生成强相关选择题，别问"你懂了吗"
2. 检查点必须 3 选项，1 正 2 错，错选要对应误区
3. 单次只讲一个关键点
4. 学生选"我不知道"是降难度信号
5. 输出必须是 JSON，不裹 markdown
6. message 非空中文，直接展示
7. 不要冗长思考，直接给 JSON（v0.3 新增，缓解长 thinking）
```

## 10. 异常与 fallback

`generate_tutor_turn_stream` 的解析策略：

- raw 完整后尝试 `extract_json_object` + `TutorTurn.model_validate`
- 失败（JSONDecodeError / ValidationError / ValueError）→ `recover_tutor_turn_from_raw(raw)`：用正则抠 `message`/`phase`/`action` 字段，给最小可用 turn
- `message` 仍为空 → 兜底文案（避免完全无输出）
- LLM/网络异常 → re-raise，由 chat 路由转 SSE error

每一次 fallback 都会在 `logs/sessions/*.jsonl` 里标 `parse_ok=false`、`used_fallback=true`，便于事后排查某轮为什么学生看到了奇怪文案。