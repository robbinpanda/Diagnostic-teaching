# 上下文、Session 恢复与诊断日志

> 本文描述现行持久化与恢复边界。先读 [系统总览](./system-overview.md) 可快速建立组件和主流程概念，完整文档入口见 [文档导航](./README.md)。

版本：v1.7

日期：2026-08-06

适用项目：诊断式数学答疑 MVP

本文档说明三件事：模型每轮收到什么，历史 session 如何恢复，以及 SQLite、JSONL、Markdown 日志分别承担什么职责。

## 1. 数据职责

系统有一条权威业务数据线和两种只追加日志：

| 数据 | 职责 | 是否用于恢复 |
|---|---|---|
| SQLite 业务表 | 保存 session、`exam_papers`、durable `session_inputs`、结构化 messages、checkpoints、层级 `card_folders`、study_cards、`mistake_sets`/`mistake_set_items` 快照、`session_runs` 和 action 关联 | 是，唯一快照来源 |
| SQLite `session_events` | 保存稳定业务边界的有序 change feed，供客户端断线补发 | 是，仅用于增量重放 |
| `<session_id>.jsonl` | 严格的一行一事件机器日志，便于脚本分析和审计 | 否 |
| `<session_id>.log.md` | 与 JSONL 同步写入、留白充足的人类可读时间线 | 否 |

JSONL 不是数据库，也不承担断点续聊。它可能因为日志目录被清理、写盘失败或版本变化而不完整；SQLite 才保存可继续运行所需的关系数据。`session_events` 虽然也是 append-only，但它是 SQLite 内受事务保护的业务 change feed，与诊断 JSONL 是两套数据，不能互相回填或替代。

SQLite schema 由 `apps/api/migrations/versions/` 下的 Alembic revision 管理。后端构造 `Database` 时先自动执行 `upgrade head`，不再在运行期用 `_ensure_column` 临时补列。旧库首次启动会进入兼容迁移，现有行和已归档全局卡片都会保留；之后由 `alembic_version` 记录 revision。详见 `docs/database.md`。

### 1.1 Durable input 接纳边界

正式 session 不再要求“HTTP 流连接活着”才能拥有学生输入。输入接纳服务位于：

```text
apps/api/app/services/input_acceptance.py
```

该文件是稳定的公共门面；首次建会话、普通消息、卡片关闭和 checkpoint 答案分别由同目录下的分域模块实现。拆分只隔离代码职责，每一种输入仍在自己的单一 `BEGIN IMMEDIATE` 事务中同时写入 `session_inputs`、业务状态和对应稳定事件。若 SQLite 在取写锁或提交时返回 `BUSY/LOCKED`，连接上下文先回滚整笔事务，再以 50ms、150ms 的两次有限等待从操作开头重放；不会只重放某条 SQL。其他数据库错误不重试。

它与生成服务的边界是：

```text
接纳：HTTP input/answer -> BEGIN IMMEDIATE -> session_inputs + 对应业务状态 -> COMMIT
生成：POST /api/chat/stream -> 读取 SQLite session/messages -> 调 LLM -> 保存 assistant action
```

单题首条普通消息可使用 `POST /api/sessions/start`：浏览器同时提供稳定的 `sess_<uuid>` 和 `client_message_id`，服务端在一个 `BEGIN IMMEDIATE` 事务中创建 session、写 `session_inputs`、写第一条 `STUDENT_RESPONSE` 并追加 durable events。文字拆题后的多题使用 `POST /api/sessions/batch-start`，同一事务依次接纳最多 20 个 `SessionStartRequest`；图片确认框选后使用 `POST /api/sessions/image-batch-start`，后端先裁剪再走同一批量接纳事务。响应丢失后以原 session/message 标识重试会返回 `duplicate`，不会生成第二批 session。后续普通消息继续使用 `POST /api/sessions/{session_id}/inputs`。

兼容路由 `POST /api/sessions` 仍可只创建 session，但不会接纳首条 student message，也不具备 `/api/sessions/start` 的客户端幂等键语义。新客户端提交首条普通消息时必须使用 `/api/sessions/start`。

`session_inputs` 保存：

```text
id / session_id / kind / idempotency_key / payload_json / result_json
message_id / checkpoint_id / card_id / created_at
```

允许的 `kind`：

- `STUDENT_MESSAGE`：普通开放消息，可含文字、图片或两者；`idempotency_key` 来自前端 `client_message_id`。
- `CHECKPOINT_ANSWER`：checkpoint answer；每个 `checkpoint_id` 在数据库唯一。
- `CARD_DISMISSED_CONTINUE`：知识卡片解决后的继续命令；每个 `card_id` 只允许一次。保存时与 `study_cards.saved_at/content_json` 同事务写入，舍弃时与待归档卡片删除及 `card.discarded` 事件同事务写入。

普通消息 API：

```http
POST /api/sessions/{session_id}/inputs
Content-Type: application/json

{
  "kind": "STUDENT_MESSAGE",
  "client_message_id": "浏览器生成且重试时复用的 UUID",
  "message": "可选的图片说明",
  "image_data_url": "data:image/png;base64,..."
}
```

`message` 与 `image_data_url` 至少提供一项。后续图片只允许 PNG/JPEG/WebP，沿用 12 MiB 图片上限，并要求 session 绑定的 profile 为多模态。图片 data URL 同时进入 `session_inputs.payload_json` 和对应 student message 的 `metadata_json`；它不会覆盖 session 级 `problem_image_data_url`。因此首张题图仍固定属于 `SESSION_START`，后续图片则保留各自的消息顺序，历史恢复和显式分支恢复都会原位带回。

稳定结果：

- 第一次：`201`，`status=accepted`，返回 `input_id / message_id / action_id`。
- 同一个 `client_message_id`、规范化后相同 message：`200`，`status=duplicate`，返回第一次结果，不再新增 message。
- 同一个 `client_message_id`、不同 message 或不同 kind：`409`，`code=IDEMPOTENCY_KEY_CONFLICT`。

知识卡片继续命令使用同一路径，payload 为：

```json
{
  "kind": "CARD_DISMISSED_CONTINUE",
  "client_command_id": "card:<card_id>",
  "card_id": "card_...",
  "content": {
    "type": "knowledge_card",
    "title": "用户确认后的标题",
    "knowledge_point": "...",
    "core_idea": "...",
    "derivation_steps": [{"title": "...", "content": "..."}],
    "when_to_use": ["..."],
    "common_mistakes": [],
    "connection_to_problem": "..."
  }
}
```

舍弃同一张待归档知识卡片时不提交 `content`，而是使用：

```json
{
  "kind": "CARD_DISMISSED_CONTINUE",
  "client_command_id": "card:<card_id>",
  "card_id": "card_...",
  "save_to_library": false
}
```

保存与舍弃共用同一个稳定 `client_command_id` 和一次性解决范围；响应丢失后必须用相同 payload 重试，不能把同一个 key 从保存改成舍弃或反向修改。

`content` 为兼容旧客户端可省略；新前端始终提交用户最终确认的知识卡片。它参与 `payload_json` 的规范化和幂等比较，并与 `title/content_json/saved_at`、控制输入在同一个事务中提交。同一 `client_command_id` 用相同内容重试会返回第一次结果，用不同内容重试则返回 `IDEMPOTENCY_KEY_CONFLICT`。

输入接纳服务本身只负责一次性业务写入和重试结果稳定；稳定事件重放/SSE 续传由 `session_events` 提供，生成生命周期与显式中断由 `session_runs` 和 coordinator 提供。assistant action 仍以 run 状态门闩保护的完整事务为提交边界，不把半截 token 当成可恢复结果。

## 2. 每轮真正发给模型的消息

入口：

```text
apps/api/app/core/teaching_controller.py
```

入口负责 prompt、历史消息组装与流式生成编排；TutorTurn 的容错解析位于 `tutor_turn_parsing.py`，action/context 的强制策略和 `wait_for_student` 推导位于 `tutor_turn_policy.py`。`teaching_controller.py` 继续转出这些公共函数，旧导入路径保持兼容。

核心函数：

```python
build_messages(session, history)
```

`build_messages()` 先产生统一的真实多轮数组：

```text
system
user      SESSION_START
user      学生消息
assistant 教学 action
user      学生回答或 checkpoint_result
assistant 教学 action
assistant 带 knowledge_card / problem_card 的教学 action
...
```

历史中的每条 SQLite message 都单独映射成一条 `user` 或 `assistant` 消息，不再把整段历史拼进最后一个大 user prompt。

`app/llm/provider.py` 再按 profile 分发协议：`openai` 把 system 转成 Responses 的 `instructions`、其余历史转成 `input`，并把统一题图转换为 `input_image`；`openai_compatible` 原样发送到 Chat Completions；`anthropic` 把 system 从 messages 中提到顶层、合并相邻同角色消息，并把统一 `image_url` data URL 转成 Anthropic base64 image source。协议转换不改变 SQLite 历史结构，也不会把 API key 写入消息或日志。

OpenAI Responses 成功完成后，后端把 `response.id` 作为 provider continuation metadata 与对应 assistant action 在同一个 SQLite 消息事务中保存。下一轮仍重新发送最新 `instructions`，但通过 `previous_response_id` 复用此前 Responses 状态，`input` 只包含该响应之后新增的学生消息或工作流继续命令，避免把推理模型的多轮状态退化成纯文本 assistant 重放。continuation 只在 provider、model profile 和 model 都匹配时启用；若上游因响应过期或代理不支持而以 400/404 拒绝，provider 层会在同一轮自动取消 continuation 并用 SQLite 完整历史重放一次。JSONL/Markdown 不是 continuation 恢复来源。

profile 的统一 `reasoning_effort=none|low|high` 由 `app/llm/reasoning.py` 管理，默认值为 `low`。映射只取决于请求协议：OpenAI Responses 发送 `reasoning.effort`，OpenAI-compatible Chat Completions 发送顶层 `reasoning_effort`，Anthropic Messages 发送 `output_config.effort`；不再按 Host 或模型名切换字段，也不再通过 system prompt 模拟档位。添加模型时，后端会对完整的 `protocol + Base URL + API key + model` 并发测试三个档位，并把成功项保存到 `reasoning_effort_options_json`；同一模型经不同 Base URL、账号或代理可得到不同选项。跳过测试的 profile 默认暴露三档。保存后的档位覆盖正式答疑、文字拆题、图片题目框检测、图片内容识别和多模态能力测试。

应用层不再设置“固定保留 20 条”之类的截断，也不做摘要或压缩。`SessionRepository.list_messages(session_id)` 默认读取该 session 的全部消息并按时间正序发送。

仍需注意：模型服务自身有硬上下文窗口。项目不主动截断，但实际总 token 超过所选模型限制时，供应商仍可能拒绝请求。

### 2.1 system 消息

system 消息由四部分组成：

1. `SYSTEM_PROMPT`：教师角色、教学原则和强规则。

2. `ACTION_PROTOCOL`：像工具说明一样，在第一次及后续每次请求中明确列出每个教学 action 的用途、必需字段、阻塞性和后端行为。

3. `JSON_CONTRACT`：要求模型只返回一个按 action 区分的最小 `TutorTurn` JSON，`message` 排在最前，无关 checkpoint/card 字段不输出 `null`。

4. 当前 action loop 约束：连续非阻塞动作数，以及是否必须转成阻塞动作。

5. profile 当前保存的推理档位；字段由 provider 层按 OpenAI-compatible 或 Anthropic Messages 协议直接加入请求体，system prompt 不追加推理强度指令。

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
  "context_status": "need_problem|need_thought|ready",
  "problem_text": "题目正文",
  "student_initial_thought": "学生初始思路",
  "current_state_hint": "diagnosing",
  "has_problem_image": false
}
```

如果题目有原图，这条消息使用多模态 content，同时携带文本 JSON 和 `image_url`。

`grade_band` 在 session 创建时固定为 `junior` 或 `senior`，之后每轮都作为 `SESSION_START` 上下文的一部分提供给模型。它用于提示答疑的知识范围与表达方式：`junior` 侧重基础概念、直观解释和规范步骤，`senior` 允许高中知识、综合方法与完整推导。后端不会据此更换模型，也没有按课程知识点做硬性白名单校验；session 创建后前端禁止切换，保证同一会话口径一致。

`context_status` 是 SQLite 中可恢复的上下文收集状态。模型在确有可靠新增时输出 `problem_summary / student_thought_summary`；后端做单调归一化并与完整 assistant action 同事务写回。`need_problem / need_thought` 时后端只允许 `ASK_OPEN_QUESTION`，但保留模型原始 `message`，不再用通用问题覆盖正文，也不会因为末尾没有问号而改写；`ready` 后才开放其他教学 action。字段来自完整对话语义而非消息顺序；“完全没思路”是有效思路状态。模型明确输出 `ready` 且题目已经存在时，摘要字段可以省略，后端不会因此把本轮降回 `need_thought`。

拆题与正式答疑是两条隔离链路。文字草稿先交给 `POST /api/problem-intake/analyze-text`，由当前所选模型只返回 `problems[]`：每项包含自包含的 `problem_text` 和仅属于该题的 `student_initial_thought`。该结果只决定批量创建数量与各 session 初始上下文，不产生教学 action；单题同样返回长度为 1 的数组。

图片草稿先交给 `POST /api/problem-images/detect`，多模态模型只返回按版面顺序排列的归一化题目框。前端允许在图片上拖拽新增框，也允许删除、平移和按边/角缩放已有框，确认后把最终框与一份原图交给 `POST /api/sessions/image-batch-start`。后端使用 Pillow 裁剪，并为每个框创建独立 session；session 只保存自己的 PNG 裁剪图，不保存或重复发送整张多题原图。图片子 session 的 `problem_text` 初始为空，正式多模态答疑模型从自己的裁剪图和首条上传消息中确认题目摘要，仍受 `context_status` 守门约束。如果初始题图轮次第一次有效 TutorTurn 仍为 `need_problem`，生成器会清除第一次瞬时流文本，使用同一原始裁图和定向识别提示再调用一次模型；第二次结果直接采用，并在 debug 中记录 `image_need_problem_retry_count=1`。旧的 `POST /api/problem-images/analyze` 保留为兼容接口，但新建图片多题流程不再依赖它的 OCR 旁路字段。

`SessionCreate` 禁止未声明的额外字段，`build_messages()` 也只对白名单中的题目、初始思路、年级、学科、状态和可选原图组装 `SESSION_START`，防止视觉模型内部元数据旁路进入教学上下文。

文本新 session 的首条原文总是 durable student message，题目/思路摘要最初可为空并由模型后续更新；不会制造“题目/思路已收到”的 canned assistant 消息。题图 session 的首消息是上传动作，识别摘要仍放在 SESSION_START。对旧数据库，若第一条 legacy student message 与初始思路完全相同，`build_messages()` 会跳过该重复项。

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

`client_message_id` 不进入模型 prompt；它只保存在 `session_inputs.idempotency_key`，并通过 session 详情 API 的 message 字段回传，供客户端对账。模型仍只看到结构化教学语义与学生正文。若该 student message 带有 `image_data_url`，`build_messages()` 会把结构化信封作为 text block、把图片作为紧随其后的 `image_url` block，保持它在对话中的原始位置；各 provider 再转换为自己的多模态协议。

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
| `EXPLAIN_LOCAL` | 非阻塞；可选卡片确认 | 修复学生当前具体卡点；可复用知识值得记忆时可产生 `knowledge_card`，关闭归档后继续，否则直接继续 |
| `EXPLAIN_PRINCIPLE` | 非阻塞 + 卡片确认 | 系统讲解知识原理并产生 `knowledge_card`；关闭归档后继续请求模型 |
| `RESPOND_TO_CHECKPOINT` | 非阻塞 | 只对当前检查点结果给出情绪支持，不包含数学反馈、讲解、纠错、答案或提示，然后继续到下一 action |
| `ASK_OPEN_QUESTION` | 阻塞 | 停止生成，等待学生自由回答 |
| `ASK_MULTIPLE_CHOICE` | 阻塞 | 创建带诊断选项的 checkpoint，等待学生选择 |
| `SUMMARIZE` | 终止 + 卡片确认 | 自然总结并产生 `problem_card`；关闭归档后结束，无需额外确认题 |

模型只选择 action。`wait_for_student` 由后端根据 action 强制推导，模型不能自己决定。

在 action 规则之前还有上下文守门：`context_status != ready` 时，任何选择题、讲解、总结或卡片输出都会被清除并归一化成 `ASK_OPEN_QUESTION`。这条规则优先于“需要学生参与时默认选择题”。

每条新 message 都有：

- `action_id`：本条 message 对应动作的唯一 ID。

- `action`：动作类型；学生普通回答是 `STUDENT_RESPONSE`，检查点回答是 `CHECKPOINT_RESPONSE`。

- `in_reply_to_action_id`：学生正在回复的阻塞 action。

本次 action 协议升级前的会话与日志已清空，不再保留旧 action 名称兼容。

## 4. checkpoint 是学生返回的 action 结果

`ASK_MULTIPLE_CHOICE` 对应一个 `checkpoint` 选择题请求，它不是外部工具执行，而是等待学生作答的教学互动。

学生可以点击三个诊断选项或“我不知道”，也可以选择第五项“我想自己输入回答”在检查点卡片内填写原文；checkpoint 等待期间底部输入框也仍可直接输入。

自由文字通过普通 `STUDENT_MESSAGE` 接口提交，并在一个事务内把学生原文写入 message 与 `checkpoints.free_text_response`，设置 `answered_at`，追加 `checkpoint.completed(response_mode=free_text)` 和 `message.completed`。该路径保留 `selected_option_id/is_correct=null`，不会把开放表达误判为某个选项；message metadata 中的 `checkpoint_free_text_response` 明确关联原 checkpoint。刷新或恢复后它不再属于待答 checkpoint，学生原文按普通气泡展示并进入模型历史。

学生点击选项后，`POST /api/checkpoints/{checkpoint_id}/answer` 会在一个后端事务链中完成：

1. 校验 checkpoint 属于当前 session、选项存在，并写 `kind=CHECKPOINT_ANSWER` 的 durable input。

2. 把选择、正误、耗时和答题时间写入 `checkpoints`。

3. 更新 session 的 `state_hint`。

4. 直接写入一条 role=`student`、action=`CHECKPOINT_RESPONSE` 的结构化 message。

5. 用 `in_reply_to_action_id` 指向产生该 checkpoint 的 `ASK_MULTIPLE_CHOICE` action。

6. 在 message metadata 中保存完整 `checkpoint_result`。

`session_inputs.checkpoint_id` 有数据库唯一索引。同一选项重试（即使重试请求重新计算了 elapsed）返回第一次保存的结果和耗时，不新增 message、不重写 checkpoint；不同选项重试返回 `409 CHECKPOINT_ANSWER_CONFLICT`。对升级前已回答但尚无 `session_inputs` 的记录，首次同值重试会从已有 `CHECKPOINT_RESPONSE` message 兼容回填输入记录。

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

## 5. 学习卡片的待归档与持久化

`EXPLAIN_PRINCIPLE` 必须带结构化 `knowledge_card`；`EXPLAIN_LOCAL` 一旦包含值得独立记忆、可迁移的公式、定理、性质或方法辨析也必须带 `knowledge_card`，一次性代入、计算或纯本题过渡则不出卡；`SUMMARIZE` 必须带结构化 `problem_card`。后端在保存 assistant message 时，同一事务把卡片写入 `study_cards`：

两类卡片按用途严格区分：知识卡片保存脱离本题仍成立的原理和方法；题目卡片保存当前具体题目的条件、完整解题步骤和最终答案。若本题依赖的可迁移原理已经讲清但尚未形成知识卡，模型应先用 `EXPLAIN_LOCAL/EXPLAIN_PRINCIPLE` 生成知识卡，后续再用 `SUMMARIZE` 生成题目卡。同一道题允许两类卡片各一张。

```text
id / session_id / card_type / title / content_json / folder_id
source_action_id / source_message_id / created_at / saved_at / deferred_at
```

`saved_at=null` 表示卡片尚未归档，不进入右侧卡片库。卡片刚出现时 `deferred_at=null`；学生可以直接处理卡片，也可以继续在输入框提问。卡片按 `source_action_id` 锚定在来源 assistant 消息之后，不再作为时间线最末尾的全局交互；原位滚出视口后卡片自动折叠，多张已滚过原位的卡片进入有高度上限的顶部紧凑列表，点击条目会滚回原位并展开。发送新问题会在普通消息接纳事务中写入 `deferred_at` 和 `card.deferred`。同一 session 可以保留多张未归档卡片；旧卡不会再向 prompt 注入禁卡指令，后端也不会删除新生成的 knowledge/problem card 或把 `SUMMARIZE` 降级为 `EXPLAIN_LOCAL`。`GET /api/sessions/{id}` 通过 `pending_cards` 按创建时间恢复全部待处理卡片，并继续保留 `pending_card` 作为最新一张的兼容字段。知识卡片支持在内嵌编辑器中删改内容；保存时带最终内容与 `folder_id` 的 `CARD_DISMISSED_CONTINUE` 会在同一事务写入 `title/content_json/saved_at/folder_id` 和 durable control input；二次确认舍弃会以 `save_to_library=false` 记录 control input 后删除待归档行；problem card 使用带 `folder_id` 的 `POST /api/cards/{id}/save` 只归档、不继续：

- knowledge card：若学生尚未继续提问，保存或舍弃后立即以无新增 student message 的 `/api/chat/stream` 继续；若已标记为待处理，稍后保存或舍弃只处理卡片，不重复启动生成。
- problem card：保存后结束，因为来源 action 是终止动作 `SUMMARIZE`。

卡片生成时即确定默认目录，不能推迟到保存接口才猜测。若来源 session 有 `paper_id`，后端读取活动 `exam_papers.card_folder_id`，并把同一目录 ID 同时写入 `study_cards.folder_id` 与稳定 `card.ready` 事件；没有试卷归属时，仍按 `card_type` 使用“默认知识卡片”或“默认题目卡片”。保存知识卡或题目卡时目录选择优先级统一为：客户端明确提交的目录 → 卡片生成时已写入的目录 → 对应类型系统默认目录。用户在保存弹窗改选其他目录只影响当前卡片，不改变该试卷后续卡片的默认位置。

前端启动时并行调用 `GET /api/cards` 与 `GET /api/card-folders`。答疑页不再挂载右侧卡片文件管理器；“知识卡片库”和“错题卡片库”分别以已归档 `knowledge_card`、`problem_card` 为唯一数据源，并按受管目录提供跨试卷多选。错题卡片库不再从 session history 派生：未生成/未保存题目卡片的会话不会显示，已入库卡片在来源会话删除后继续存在。点击两类库内卡片都直接打开无暗色遮罩的浮动卡片窗口，不切回答疑 session；宽度 `>900px` 时窗口可拖动。已归档 knowledge card 通过 `PUT /api/cards/{id}` 提交完整 `content`；待归档卡片和 problem card 不允许走该更新接口。

`card_folders` 以可空 `parent_id` 自关联形成目录树；`0006_card_folders` 创建两个默认根目录，并把旧卡片按类型迁入对应目录。`0013_paper_archive_folders` 增加只读的 `managed_kind`/内部稳定 `managed_key`：受管根“按试卷归档”下，每份试卷对应一个稳定的同名受管目录。知识卡与题目卡共用该目录；目录不随 `exam_papers` 删除，同名试卷重建后复用原目录及其中旧卡。受管根和试卷目录不可重命名、移动或删除，但卡片仍可移入、移出、复制和删除。

数据库内部另外使用可空的 `study_cards.live_session_id` 作为真实外键。卡片生成时它与来源 `session_id` 相同；删除会话时，触发器先删除 `saved_at=null` 的待归档卡片，已归档卡片则由 `ON DELETE SET NULL` 解除活动会话关系。不可变的来源 `session_id / source_action_id / source_message_id` 仍保留，因此全局卡片既不会被误删，也不会丢失来源审计文本。

“知识卡片库”和“错题卡片库”先进入多选模式：总览页可按整份试卷选择，试卷详情页可逐张选择，并按点击顺序维护跨卷选择。导出弹窗不再重复选择卡片或版式，知识卡片固定使用 A4 纵向双列紧凑排版，并与答疑卡片一致输出关键关系、核心原理、推导、适用场景、易错点和题目连接。导出完全使用前端已有的结构化卡片数据和 KaTeX 渲染，不新增副本、不修改 SQLite，也不把卡片上传到外部服务。两个卡片库的多选删除在用户确认后调用 `POST /api/cards/bulk-delete`；后端先在 `BEGIN IMMEDIATE` 中确认全部 ID 都是已归档卡片，再一次性删除，任一 ID 失效时不产生部分删除，来源 session、消息和日志保持不变。

`0015_mistake_set_problem_cards` 为 `mistake_set_items` 增加 `problem_card_json`。创建错题集时，客户端提交有序 `card_ids`，后端只接纳已归档题目卡片并在同一事务中快照完整 `problem_card`；卡片即使已因来源 session 删除而把 `live_session_id` 置空，仍可创建错题集。再次打开或打印只依赖快照。错题集总览同样支持多选，并在用户确认后调用 `POST /api/mistake-sets/bulk-delete` 原子删除所选集合及其 item 快照；来源题目卡片不受影响。错题打印与知识卡片共用固定双列紧凑卡片版式，并输出题目摘要、解题思路、关键步骤、思考来源、易错提醒和最终答案；“只看题目摘要”仅改变本次预览/打印，把其余解析替换为空白练习区，不修改快照。

assistant 历史消息的 `metadata_json` 同时保存 `card_id` 和结构化 card，保证模型历史仍是完整 `TutorTurn` 格式；会话恢复时会重建 card ID、action ID 和 message ID 的引用。

## 6. SQLite session 恢复

左侧会话栏调用：

```text
GET  /api/sessions/history
GET  /api/sessions/{session_id}
GET  /api/sessions/{session_id}/events
GET  /api/sessions/{session_id}/events/stream
POST /api/sessions/restore
DELETE /api/sessions
DELETE /api/sessions/{session_id}
```

历史列表直接查询 SQLite，包括题目摘要、模型、message 数、checkpoint 数、状态和更新时间。

点击左栏会话使用 `GET /api/sessions/{session_id}` 读取原 session、messages、未答 checkpoint 和待归档 card；该操作不写数据库、不生成新 ID。这样会话列表真正承担对话选择器的职责，普通查看与继续答疑不会制造副本。

`POST /api/sessions/restore` 是显式实验分支能力，不是左栏普通打开动作。调用它时会复制出一个新 session：

1. 复制 session 题目、原图、初始思路、状态和卡点。

2. 复制全部 messages、checkpoints，以及仍需继续原工作流的待归档 study_cards；已归档卡片属于全局库，不重复复制。普通消息对应的 `STUDENT_MESSAGE` 输入记录会随 message 重映射，保持 `client_message_id` 幂等；checkpoint 输入可由复制后的结构化结果按需兼容回填。

3. 为新副本重新生成 message ID、action ID、checkpoint ID 和 card ID。

4. 同步重写 `in_reply_to_action_id`、`source_action_id`、`source_message_id` 和 metadata 中的 checkpoint/card 引用。

5. 在新 session 的 `restored_from` 记录来源 ID。

6. 若最后有未回答的 checkpoint 或未归档 card，前端恢复后在消息时间线重新显示对应内嵌交互；否则恢复对话消息并可继续输入。

这样原始实验记录保持不变，恢复后的新分支也有独立、完整的数据关系。

删除历史会话会在一个 `BEGIN IMMEDIATE` 写事务内再次检查该 session 没有 queued/running run，读取其准确 `paper_id`，删除 session，并由数据库外键级联删除 session_inputs、messages、checkpoints、session_events、session_runs。数据库触发器删除尚未关闭的待归档卡片，已归档学习卡片只解除 `live_session_id` 外键并继续保留，来源审计字段不变。若被删 session 是原试卷最后一条引用，同一事务同时删除该 `exam_papers` 行；受管卡片目录和其中旧卡不删除。事务提交后路由层再尽力删除对应 JSONL/Markdown 诊断日志，日志失败只记录 warning，不能把已经成功的 SQLite 删除改报失败。

`DELETE /api/sessions` 是批量版本：在同一事务内检查全局活动 run，删除全部 session 和全部 `exam_papers`；外键和触发器同步处理 session_inputs、messages、checkpoints、session_events、session_runs 与待归档卡片。事务提交后再尽力删除日志目录中的所有 `.jsonl` / `.log.md` session 日志。已归档全局卡片、受管目录和模型配置保留。若仍有答疑流正在生成，接口返回 409，避免清空后被并发写回。

普通创建、批量创建和显式 restore 都会在自己的写事务内重新验证 `paper_id`。若另一个窗口刚删除了最后会话及其试卷，提交陈旧 paper ID 的创建请求会返回“所选试卷已不存在，请重新选择”，而不是留下悬空外键或暴露 SQLite 500。

## 7. Run 是可恢复业务态，不是诊断事件流

SQLite `session_runs` 是每次生成请求的权威生命周期记录。`run_id` 由后端生成，`client_run_id` 由浏览器为一次生成意图稳定生成，`session_id + client_run_id` 唯一；`attempt` 在同一 session 内事务递增。`queued_at / started_at / finished_at / updated_at` 记录阶段时间，`error_json` 保存结构化终态原因，`last_committed_action_index` 记录本 run 最后一个原子提交的完整教学 action。重复的 `client_run_id` 返回既有 run，不再次进入 coordinator 或 provider。

coordinator 只保存当前进程的执行对象、每 session 锁和 provider 子任务引用，用于串行、查询和取消；它不是恢复来源。`GET /api/sessions/{session_id}/run` 同时核对 coordinator 的 active/running 状态与 SQLite 活动或最新 run。进程启动时，SQLite 中仍为 `queued/running` 的旧记录统一转为 `failed/process_restarted`，不会根据 JSONL 或内存状态续跑。

显式中断调用 `POST /api/sessions/{session_id}/interrupt`。后端先提交 `interrupted/explicit_interrupt`，随后取消 provider 子任务并终止 bounded loop；重复调用或 session 当前空闲时是 no-op。客户端自行关闭 fetch/页面只会触发响应清理，run 记为 `failed/client_disconnected`，不等同于显式中断。

assistant message、checkpoint、pending card 和 `last_committed_action_index` 在受 run 状态保护的 SQLite 事务中提交。未完整解析的 provider 输出、仅发送过 `message_delta` 的半成品和中断后才到达的结果都不会写入 messages。JSONL/Markdown 仍可记录取消前的诊断片段，但不能据此恢复 action。

学生在生成期间发送的新内容称为插嘴。前端允许连续发送多条，把每条原文及稳定 `client_message_id` 按顺序保存在浏览器 outbox，并立即显示学生气泡；当前 provider 请求继续完成，不调用 interrupt，也不把瞬时半截输出写成 message。当前完整 action/run 提交后，outbox 逐条调用普通 `STUDENT_MESSAGE` 接纳接口，全部成功后只启动一个新的 `/api/chat/stream`。因此新一轮模型历史中按顺序包含全部插嘴，而不会产生支线、恢复状态或重复 run。

若当前输出最终产生 checkpoint，第一条插嘴按自由文字路径原子完成它；若产生 card，第一条插嘴按普通接纳规则原子设置 `deferred_at`。浏览器刷新恢复 outbox 时会先等待当前 active run 结束，再接纳尚未提交的插嘴，仍保证“先接纳、后生成”。显式停止生成是独立操作：`POST /api/sessions/{id}/interrupt` 只记录 `interrupted/explicit_interrupt` 并丢弃未完成片段。

## 8. 诊断日志

日志目录：

```text
logs/sessions/
```

### 8.1 JSONL：给机器

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

### 8.2 Markdown：给人

```text
logs/sessions/<session_id>.log.md
```

每次写 JSONL 时同步追加 Markdown。每个事件独立成节，system/user/assistant 消息分别显示，prompt、raw、解析 action 和 checkpoint 回答之间都有空行与分隔线。

为避免文件巨大，Markdown 阅读版会省略题图的 base64；原始 JSONL 首次模型调用和 SQLite session 仍保留必要数据。

日志写入失败不会中断教学主流程。也正因如此，日志只能用于诊断，不能作为恢复依据。

## 9. 流式输出

### 9.1 当前 chat 生成流

生成链路（学生输入已在这之前提交并落库）：

```text
provider.chat_stream_completion()
  -> 瞬时 provider 错误按 Retry-After 或 2/4/8/16 秒指数退避（最多 4 次/60 秒）
  -> MessageStreamExtractor.feed(delta)
  -> generate_tutor_turn_stream()
  -> chat.py SSE
  -> useSessionRuntime.runStream()
```

常见事件顺序：

```text
run_started
progress（正在读取题目 / 核对思路 / provider 退避重试 / 选择教学方式 / 组织回复）
message_delta ...
message_reset（仅格式重试时可能出现）
decision
checkpoint_ready（可选）
card_ready（可选，仅 knowledge_card / problem_card）
message_done
stream_complete（仅在 run.completed 与最后 action 已原子提交后）
run_interrupted（仅显式中断，且没有当前 step 的完整 action 落库）
```

只有学生可见的 `message` 字段会增量展示。`progress` 只携带后端定义的 stage/label/elapsed_ms；provider reasoning chunk 的原文不会进入 SSE。TutorTurn 最多执行 3 次总格式尝试；每次非法 JSON 后 `message_reset` 会让前端丢弃该 action 已展示的残片，再把校验错误反馈给模型纠正，最多纠正 2 次。`state_hint`、`action`、`checkpoint` 和 card 必须等完整 JSON 到达、校验和后端策略归一化后才发出。`card_ready` 后当前 HTTP stream 停止，等待前端保存卡片。

文字拆题、题图区域检测和图片内容分析调用 `structured_json_completion()`。该助手共享 JSON 对象提取、必需字段校验、最多 3 次结构化尝试以及最多 4 次/60 秒的瞬时 provider 退避；第一次格式错不再直接 502。`problems=[]` 等“schema 合法但业务上没有识别结果”的响应仍交给路由返回 422，不消耗格式纠正重试。

`message_delta/message_reset` 是高频瞬时事件，不写 `session_events`。完整 student/assistant message、归一化 action、checkpoint/card、run 完成、error 和 idle 等稳定边界会与业务数据一起写入 SQLite。`streamChat()` 必须看见 `stream_complete / error / run_interrupted` 之一；无明确终态的 EOF 是失败。断流后前端查询 `/run`，已提交 action 时重载 session；未提交且 `retryable=true` 时以新 run、同一业务历史受控重试一次，绝不凭半截字符恢复。

每个 `tutor_turn` 诊断日志记录 `input_to_first_progress_ms`、`input_to_first_reasoning_event_ms`、`input_to_first_content_ms`、`input_to_first_visible_message_ms`、`input_to_interactive_turn_ms` 和 `total_completion_ms`。缺少 provider reasoning 事件时对应指标为 `null`，不能据此推断模型完全没有内部推理。

### 9.2 durable event 历史与 SSE

有限历史：

```text
GET /api/sessions/{session_id}/events?after_seq=0&limit=100
```

`limit` 最大 200，按 session 内 `seq` 升序返回。持续订阅：

```text
GET /api/sessions/{session_id}/events/stream?after_seq=42
Last-Event-ID: 42  # 可替代 query
```

连接先补发 `seq > cursor` 的 durable events，再继续跟随 SQLite 新写入。每帧都带 `id: <seq>` 和统一 `schema_version=1` 信封；网络重复投递时，客户端忽略 `seq <= lastAppliedSeq` 即可幂等处理。客户端首次打开 session 仍先读 `GET /api/sessions/{session_id}` 的完整快照，再跟随事件；旧库升级不会根据 messages 或 JSONL 伪造历史 event。

事件类型、字段、版本升级规则和最小消费示例见 `docs/session-events.md`。

### 9.3 前端运行态、取消与重放适配边界

`apps/web/app/page.tsx` 只保留页面展示和普通列表操作；会话运行态下沉到：

```text
useSessionRuntime
  -> session-workflow.ts       composer/run/checkpoint 对话状态；pending card 独立并行
  -> stream-controller.ts      每个 run 独立 AbortController
  -> stream-protocol.ts        SSE -> sessionId/runId/可选 seq 的规范事件
  -> timeline.ts               message 拼接、reset/final 校准、重复与迟到事件规则
```

controller 以 session id 为键保存多条活动 `streamChat`。切换会话或新建答疑只改变当前视图，不 abort 原 session 的 fetch；同一 session 的新 run 只 supersede 自己的旧 run，不同 session 可继续并发。用户点击停止时，前端只针对当前 session 调用 interrupt 接口，让后端把对应 run 原子落为 `interrupted` 并取消 provider，再收束该 session 的本地 fetch；页面卸载才统一取消全部本地连接。

timeline reducer 仍校验 event 的 session id 与本地 run id，因此后台流和迟到回调不能写入当前打开的另一个 session。重新打开仍在生成的 session 时，页面先读取 SQLite 快照恢复已提交 action，再依据 controller 中该 session 的活动 run 接收后续事件；切换期间遗漏的半截字符不作为恢复依据，最终 `decision` 或下次 SQLite 快照负责校准完整内容。显式停止时仅移除尚未 `message_done` 的临时 assistant 片段；已经完成的 action 和学生消息保留，SQLite 仍是重新打开会话时的唯一权威来源。

图片检测阶段尚未创建 session。前端把原图 Blob 和 `pending / detecting / selecting / starting` 阶段写入 IndexedDB；检测结果及每次新增、删除、移动、缩放后的框持续覆盖同一草稿。确认时按 region id 为每个最终框生成并保存稳定的 session id 和 `client_message_id`，随后后端在一个批量事务中裁剪并接纳全部子会话。刷新后，pending 恢复到 composer，detecting 重新执行检测，selecting 恢复编辑后的框，starting 使用相同 IDs 幂等续交。成功后第一题绑定当前视图，其余题作为独立后台 session 并行生成；成功或明确取消才清理 IndexedDB 草稿，且所有流继续由 `sessionId + runId` 隔离。

chat 流与 durable change feed 的边界如下：

- chat SSE parser 可读取可选 `id:`，事件适配器也可读取 `data.seq`；`streamChat` 仅在调用方显式给出 replay cursor 时发送 `after_seq`。
- 第 9.2 节的 session-events 接口已经提供稳定业务边界的 SQLite 重放；当前页面仍以 session 快照恢复，并用 chat SSE 展示本轮字符流，两者不能混成同一个 exactly-once 承诺。
- reducer 会按已有 event id、单调 seq、terminal 事件和 checkpoint/card ID 做确定性去重；没有身份的 `message_delta` 仍按网络到达顺序处理。

前端状态测试运行：

```bat
cd apps\web
npm test
```

## 10. 排查建议

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
