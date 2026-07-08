# 上下文管理与诊断日志

版本：v0.5
日期：2026-07-08
适用项目：诊断式数学答疑 MVP

本文档说明每轮 LLM 调用的上下文如何构造，学生检查点选择如何进入下一轮 prompt，以及 SQLite / JSONL / SSE / 前端渲染各自承担什么职责。

## 1. 一句话模型

当前系统里有两条数据线：

- **业务态线**：SQLite 保存 session、messages、checkpoints，驱动当前产品继续运行。
- **诊断线**：JSONL 保存完整 prompt、LLM raw、解析结果、fallback、错误与检查点答案，供开发者复盘。

LLM 每轮看到的不是数据库全量，而是由 `build_messages(session, history)` 拼出的最近上下文。

## 2. Prompt 入口

入口文件：

```txt
apps/api/app/core/teaching_controller.py
```

核心函数：

```python
build_messages(session, history)
```

每轮 LLM 调用只发两条 chat messages：

```txt
system: SYSTEM_PROMPT
user:   题目 + 学生初始思路 + 当前阶段 + 历史对话 + JSON 输出合同
```

`user` prompt 的结构：

```txt
题目：
{session['problem_text']}

学生初始思路：
{session['student_initial_thought'] or '学生还没有提供明确思路'}

当前阶段：{session['phase']}
历史对话：
{render_history_row(row) × 最近 20 条}

请决定下一步教学动作。记住：如果讲解已经涉及关键跳步，优先生成一个选择题检查点。
{JSON_CONTRACT}
```

这意味着后续优化“模型怎么教”时，`SYSTEM_PROMPT`、最后一句策略提示、`JSON_CONTRACT` 是最直接的杠杆。

## 3. history 来源

`SessionRepository.list_messages(session_id, limit=20)` 从 SQLite `messages` 表取最近 20 条，按时间正序喂给 LLM。

当前写入 messages 的角色：

| role | 内容来源 | 说明 |
|---|---|---|
| `student` | 学生输入框 | 普通学生发言 |
| `student` | 检查点选择回传 | 仍用普通 student role，metadata 带 `checkpoint_answer` |
| `assistant` | LLM 解析后的 `turn.message` | 净化后的可见讲解，不存 raw JSON |
| `system` | 前端本地状态 | 目前主要是界面提示；不作为核心教学策略依赖 |

重要历史修复：不再使用 `student_checkpoint` 角色。检查点答案必须变成普通学生语言进入上下文，例如：

```txt
student: 我在检查点「若 $a_1$、$a_5$ 是方程根，则 $a_1 \cdot a_5$ 等于多少？」选了：B $a_1 \cdot a_5 = 6$
```

这样 LLM 能清楚知道“学生刚才选错了哪一个数学选项”。

## 4. render_history_row

```python
def render_history_row(row):
    role = row["role"]
    content = row["content"]
    if role == "assistant" and ('```json' in content[:30] or '"phase"' in content[:200]):
        content = recover_tutor_turn_from_raw(content).message
    return f"{role}: {content}"
```

作用：

- 新数据：assistant message 已经是净化后的中文讲解。
- 老数据兼容：如果历史里曾经存过 raw JSON，就 recover 出 `.message` 再喂给 LLM。

这避免下一轮 prompt 里出现一坨 `{"phase":...}`，污染模型对话历史。

## 5. 检查点答案的双写

学生答检查点后会发生两件事：

### 5.1 权威答题数据写 checkpoints 表

接口：

```txt
POST /api/checkpoints/{checkpoint_id}/answer
```

写入：

- `selected_option_id`
- `is_correct`
- `elapsed_ms`
- `answered_at`

并根据结果更新 session phase：

| event | next_phase |
|---|---|
| `CHECKPOINT_CORRECT` | `scaffolding` |
| `CHECKPOINT_WRONG` | `recovering` |
| `CHECKPOINT_UNKNOWN` | `recovering` |

### 5.2 学生选择写 messages 表，进入下一轮 LLM

前端随后调用：

```txt
POST /api/chat/stream
```

body 中包含：

```json
{
  "session_id": "sess_...",
  "message": "我在检查点「...」选了：B $a_1 \\cdot a_5 = 6$",
  "checkpoint_answer": {
    "checkpoint_id": "chk_...",
    "selected_option_id": "B",
    "is_correct": false,
    "event": "CHECKPOINT_WRONG"
  }
}
```

`chat.py` 把 `message` 写成 `student` role，并把 `checkpoint_answer` 写入 metadata。metadata 目前主要用于落库与诊断，不直接改变 prompt 渲染；真正影响模型的是那句自然语言 student message。

## 6. SQLite 保存什么

SQLite 是当前业务态。

| 表 | 作用 |
|---|---|
| `model_profiles` | 模型配置、base_url、model、加密 API key、temperature、max_output_tokens |
| `sessions` | 题目、初始思路、当前 phase、当前 breakpoint |
| `messages` | 最近对话历史，下一轮 prompt 来源 |
| `checkpoints` | 检查点题干、选项、正确答案、学生选择、耗时 |

SQLite 不保存完整 LLM raw，也不保存完整 prompt。这样业务态更干净，但排查问题必须看 JSONL。

## 7. JSONL 保存什么

落点：

```txt
logs/sessions/<session_id>.jsonl
```

一行一个事件，append-only。

### tutor_turn

包含：

- `prompt_messages`：完整 system + user prompt
- `raw_response`：模型原始返回，可能带 markdown fence 或坏 JSON
- `parsed_turn`：最终解析出的 phase/action/message/checkpoint
- `latency_ms`
- `parse_ok`
- `used_fallback`
- `error`

### checkpoint_answer

包含：

- checkpoint 问题
- 学生选择
- 是否正确
- misconception
- elapsed_ms
- event
- next_phase

JSONL 是“看卡点”的核心证据。它只写不读，不影响主流程。

## 8. 流式输出与上下文

主链路：

```txt
provider.chat_stream_completion()
  -> MessageStreamExtractor.feed(delta)
  -> generate_tutor_turn_stream()
  -> chat.py SSE
  -> 前端 runStream()
```

每个模块职责：

| 模块 | 职责 |
|---|---|
| `provider.py` | 调 OpenAI-compatible `chat/completions`，使用 `stream=true` |
| `MessageStreamExtractor` | 从 raw JSON token 中实时抽取 `"message"` 字段可见文本 |
| `generate_tutor_turn_stream` | 先 yield `message_delta`，raw 完整后解析 `TutorTurn` |
| `chat.py` | 转成 SSE 事件，更新 session，创建 checkpoint |
| `page.tsx` | 增量更新 assistant 气泡，收到 `decision.message` 时兜底补齐 |

为什么只流式 `message`：

- `message` 是学生可见文本，实时显示能明显改善体感。
- `phase/action/checkpoint` 必须等 raw 完整后解析，尤其 checkpoint 要做结构校验，不能半截透出。

## 9. SSE 事件与前端状态

事件顺序通常是：

```txt
event: message_delta
event: message_delta
...
event: decision
event: checkpoint_ready
event: message_done
```

前端处理：

- `message_delta`：追加到当前 assistant 气泡。
- `decision`：更新 debug 面板，并用 `decision.message` 补齐 assistant 气泡。
- `checkpoint_ready`：打开选择题弹窗。
- `error`：显示错误盒。

`decision.message` 是一次重要兜底：如果增量提取器没有吐出完整文字，最终解析出的 `turn.message` 仍会显示给学生。

## 10. 数学公式渲染

前端显示数学文本时统一走：

```txt
apps/web/components/MathText.tsx
```

支持：

- `$...$`
- `$$...$$`
- `\(...\)`
- `\[...\]`

底层使用 KaTeX：

```txt
apps/web/app/layout.tsx 引入 katex/dist/katex.min.css
```

使用位置：

- 聊天气泡：`apps/web/app/page.tsx`
- 检查点题干和选项：`apps/web/components/CheckpointModal.tsx`

因此 prompt 里允许模型输出 LaTeX 片段，例如 `$a_3^2 = a_1 \cdot a_5$`。如果后续要进一步规范公式，建议在 `SYSTEM_PROMPT` 或 `JSON_CONTRACT` 中明确“数学公式使用 `$...$` 包裹”。

## 11. 常见排查路线

### 页面没有 AI 文字

1. 看前端是否收到 `message_delta` 或 `decision.message`。
2. 看 `logs/sessions/<session_id>.jsonl` 最后一条 `tutor_turn.parsed_turn.message` 是否非空。
3. 如果 JSONL 有 message 但页面无文字，多半是前端渲染/状态问题。
4. 如果 JSONL raw 为空或 error 非空，多半是模型/网络/超时问题。

### 反复弹同一检查点

1. 看下一轮 prompt 的 history 是否包含：
   ```txt
   student: 我在检查点「...」选了：...
   ```
2. 如果没有，说明检查点回传没进入 `/api/chat/stream`。
3. 如果有，但模型仍重复，优化 prompt 对“已答检查点后必须响应选择”的规则。

### 检查点质量差

1. 看 `raw_response.parsed_turn.checkpoint`。
2. 看错误选项 `misconception` 是否具体。
3. 必要时增强 `validate_checkpoint()`，或在 `SYSTEM_PROMPT` 中加入更强的题目相关性要求。

### 公式显示异常

1. 检查模型输出是否用 `$...$` 或 `\(...\)` 包裹公式。
2. 检查 `MathText` 是否把普通美元符号误识别为公式。
3. 检查 KaTeX 是否支持该 LaTeX 命令。

## 12. 优化时保留哪些证据

建议每次 prompt/策略改动后，至少保留：

- 一个成功 session 的 JSONL
- 一个学生选错后的 JSONL
- 一个学生选 UNKNOWN 后的 JSONL
- 前端截图
- `parsed_turn.phase/action/breakpoint` 的变化记录

这样后续比较“是不是更像老师”时，不只靠体感。
