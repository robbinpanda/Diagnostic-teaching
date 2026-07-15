# 改动记录

按时间倒序，列重要改动与对应的根因/影响。

## v1.4 — 2026-07-15

### 测试数据一键清理

- 历史会话弹窗新增“清空全部会话”：批量删除 SQLite session/messages/checkpoints、未归档流程卡片和全部 JSONL/Markdown session 日志；已归档全局卡片与模型配置保留。
- 全局卡片库新增“清空全部卡片”：删除全部知识卡片、题目卡片和待归档卡片，但保留会话、消息、checkpoint、日志和模型配置。
- 两个批量接口检测全局活跃答疑流；生成过程中返回 409，避免清空后被并发写回。
- 两项前端操作都有不可逆二次确认，并在成功后同步清理当前页面状态。

## v1.3 — 2026-07-15

### 局部讲解可选知识卡片

- `EXPLAIN_PRINCIPLE` 继续强制输出 `knowledge_card`；`EXPLAIN_LOCAL` 改为由模型按内容的独立记忆和迁移价值决定是否输出。
- prompt 明确适合出卡的内容包括公式、定理、性质和易混方法辨析；一次性代入、算术计算、符号改写或纯本题过渡不出卡，避免卡片库被低价值内容淹没。
- `EXPLAIN_LOCAL` 一旦输出 knowledge card，SSE、弹窗、关闭归档和继续答疑行为与 `EXPLAIN_PRINCIPLE` 一致；不出卡时维持原有非阻塞连续生成。
- assistant 历史上下文会保留 `EXPLAIN_LOCAL` 的可选 card，确保恢复后的模型仍看到完整 `TutorTurn`。

## v1.2 — 2026-07-15

### 全局学习卡片与标题公式渲染

- 已归档学习卡片改为跨 session 的全局卡片库：页面启动即加载，新建、恢复和删除会话都不会清空或复制已归档卡片。
- 卡片仍保留来源 session/action/message 便于审计；尚未关闭的待归档卡片继续绑定原 session，以维持弹窗确认和继续答疑逻辑。
- `GET /api/cards` 和 `DELETE /api/cards/{id}` 不再要求 session id；保存待归档卡片仍需提交来源 session id。
- 知识卡推导标题、题目卡解答步骤标题和右侧卡片列表标题统一使用 `MathText`，修复标题中的 `$...$` 公式原样显示问题。

## v1.1 — 2026-07-15

### 教学 action 标签与视觉录入修正

- 每个 assistant 消息气泡右下角显示本轮教学 action 的中文含义和协议原名；恢复后的历史消息同样显示。
- 图片识别 prompt 要求题目、学生步骤和答案中的数学表达使用 `$...$` / `$$...$$` 合法 KaTeX 格式，避免 OCR 裸公式污染后续显示。
- 要求视觉模型尽量逐行转录清晰可见的学生过程，不再把多步过程压成笼统一句；仍禁止根据题目或答案推测未写出的思维。
- 红笔及其他批改颜色的勾、叉、圈、划线、得分和批语现在必须记录，并由后端合并到“你已经想到哪一步”。若模型给出明确正误但漏写批改描述，后端会补充保守的“可见勾/叉”说明。
- 固化图片识别与答疑隔离边界：正式 session 只接受题目文本、初始思路和可选原始题图，拒绝视觉模型的其他元数据字段；裁剪图仍只用于预览。

## v1.0 — 2026-07-15

### 知识卡片与题目卡片

- `EXPLAIN_PRINCIPLE` 现在必须在 `message` 外结构化输出 `knowledge_card`，包含单一知识点、核心原理、推导步骤、适用场景、常见误区和当前题连接。
- `SUMMARIZE` 现在必须结构化输出 `problem_card`，包含题目摘要、上帝视角解法路线、逐步推理与结果、坑点、步骤来源和最终答案。
- 新增 SQLite `study_cards` 表。生成 action 时先原子写入待归档卡片，学生关闭弹窗后写 `saved_at`；未归档卡片会阻止同 session 绕过弹窗继续生成。
- `EXPLAIN_PRINCIPLE` 保持 `wait_for_student=false`，但 SSE 在 `card_ready` 后暂停；前端关闭并归档 knowledge card 后再继续答疑。`SUMMARIZE` 的 problem card 关闭归档后自然结束。
- 新增 card 查询、保存、删除 API；恢复 session 时复制卡片并重建 card/action/message 引用，尚未关闭的卡片会在恢复后重新弹出。
- 前端以统一卡片组件显示首次弹窗和历史查看；原调试面板改为可滚动、可筛选的卡片库，支持双击查看和删除。

## v0.9 — 2026-07-15

### 教学流程轻量化

- 删除 `DECOMPOSE_STEP`，避免模型先输出整题的上帝视角路线图并被该路线锚定；讲解改为只围绕当前断点选择 `EXPLAIN_LOCAL` 或 `EXPLAIN_PRINCIPLE`。
- 重排 action 决策优先级：先闭环待处理的 checkpoint，能自然收束则直接总结，有明确知识缺口再讲解，只有缺少的信息会影响教学或结论时才提问。
- 降低进入 `SUMMARIZE` 的门槛：学生不必先独立给出最终答案，也不必在总结前额外回答确认性问题。
- 在 `RESPOND_TO_CHECKPOINT.description` 中明确要求提供基于真实表现的情绪价值；答错或选择“我不知道”时降低挫败感，答对时具体认可有效思考。
- local demo 的正确答案链路改为 `RESPOND_TO_CHECKPOINT -> EXPLAIN_LOCAL -> SUMMARIZE`，覆盖无需追加确认题的自然收束。

## v0.8 — 2026-07-13

### 教学 action 协议升级

- `SHOW_CHECKPOINT_MC` 重命名为更直观的 `ASK_MULTIPLE_CHOICE`，并同步后端阻塞策略、SQLite 查询、前端恢复逻辑、local demo 和测试。
- 重写 `SYSTEM_PROMPT`、`ACTION_PROTOCOL` 和每个 action 的 `description / use_when / requires / boundaries`，让 action 名称与实际教学职责严格一致。
- `DECOMPOSE_STEP` 改为从整题全局视角给出 3—6 步解题路线图，不再与局部讲解重叠。
- `EXPLAIN_PRINCIPLE` 负责从定义和原理出发系统讲清一个知识点；`EXPLAIN_LOCAL` 只修复学生当前具体卡点。
- `RESPOND_TO_CHECKPOINT` 只闭环当前待处理的选择结果，后续讲解、提问或总结交给下一 action。
- 选择题回答后的 local demo 链路调整为 `RESPOND_TO_CHECKPOINT -> EXPLAIN_* -> ASK_OPEN_QUESTION`，避免反馈动作夹带新讲解。
- 按协议升级策略清空旧 SQLite 会话、checkpoint 和诊断日志，保留模型配置，不提供旧 action 名称兼容。

## v0.7 — 2026-07-13

### 结构化多轮上下文与 SQLite 恢复

- LLM 输入改为真实的 `system / user / assistant` 多轮 messages；每条历史消息独立发送，不再拼成单个历史文本块。
- 应用层取消固定保留 20 条的限制，不做上下文摘要或压缩。
- system prompt 新增 `ACTION_PROTOCOL`，逐项说明教学 action 的功能、格式、阻塞性和后端行为。
- `messages` 新增 `action_id / action / in_reply_to_action_id`，`checkpoints` 新增 `source_action_id`。
- checkpoint 答案由答题接口直接保存为结构化 `CHECKPOINT_RESPONSE / checkpoint_result`，下一轮不再由前端重复提交。
- 新增 SQLite 历史列表与恢复接口；恢复会复制为新 session，并重建 action/checkpoint 引用关系，JSONL 不参与恢复。

### 人与机器分开的日志

- `<session_id>.jsonl` 保持严格一行一事件，供脚本分析和审计。
- 同步生成 `<session_id>.log.md`，按消息和事件分节、增加空行，供人工直接阅读。
- 日志仍是只追加诊断数据；SQLite 是唯一可恢复的权威状态。

## v0.5 — 2026-07-08

### KaTeX 数学公式渲染

**症状**：AI 回复和检查点中出现 `$a_3$`、`\cdot`、`\frac{}` 等 LaTeX 文本时，前端按普通字符串显示，数学符号不清晰。

**修复**：
- 新增 `apps/web/components/MathText.tsx`
- 引入 `katex` 与 `katex/dist/katex.min.css`
- 聊天气泡、检查点题干、检查点选项统一走 `MathText`
- 支持 `$...$`、`$$...$$`、`\(...\)`、`\[...\]`

**后续注意**：
- 如果希望模型输出更稳定，建议在 `SYSTEM_PROMPT` 或 `JSON_CONTRACT` 中明确“数学公式使用 `$...$` 包裹”。
- 行内公式不要使用 `overflow-x: auto`，否则浏览器会给每个小公式画出迷你滚动条。

### 文档重写：LLM 主导流程

**目的**：方便后续优化教学策略，明确当前系统不是硬编码状态机，而是 LLM 每轮输出 `TutorTurn` 驱动流程。

**更新**：
- `docs/state-machine.md`：重写为“LLM 输出合同 + 后端守门 + 检查点回传 + SSE + 前端呈现”
- `docs/context-management.md`：补充 prompt 拼装、SQLite/JSONL 分工、`decision.message` 兜底、KaTeX 渲染
- `README.md`：补充当前架构和优化入口

## v0.4 — 2026-07-08

### 关键修复：AI 生成了 message 但前端不显示

**症状**：右侧 debug 面板的 `phase/action/breakpoint` 在更新，检查点也会弹出，但聊天区没有显示 AI 说的话。

**根因**：
- 后端只依赖 `message_delta` 做前端展示；如果增量提取器没有提到完整 message，最终解析出的 `TutorTurn.message` 没有补发给前端。
- 前端维护 assistant 气泡时依赖闭包变量，状态更新路径不够稳。
- 某些模型输出 `message` 内部裸引号，例如 `"这道题需要把"函数零点"和..."`，会破坏 JSON 解析。

**修复**：
- `chat.py` 的 `decision` 事件新增 `message` 字段，作为最终兜底。
- `page.tsx` 在收到 `decision.message` 时补齐当前 assistant 气泡。
- `generate_tutor_turn_stream` 记录已发出的 message 片段，最终解析后补齐缺失后缀。
- `teaching_controller.py` 增加对 `message` 内部裸引号的容错修复。
- `provider.py` 对空流、超时、HTTP 异常给出明确 `LlmProviderError`，避免空白无反馈。

**影响**：即使流式增量显示失败，最终 `TutorTurn.message` 仍会显示；模型空响应也会变成可见错误。

## v0.3 — 2026-07-07

### 关键修复：检查点答完"没反应"

**症状**：学生答完检查点后 AI 经常重复讲同一知识点、或又弹同一个检查点、或干脆没反应。

**根因**：
- `apps/web/app/page.tsx` 的 `handleCheckpoint` 答题后调 `runStream(sessionId)` **没传 message**，学生选择只以 `student_checkpoint` 这个非标准 role 写进 SQLite
- `teaching_controller.py:render_history_row` 把它渲染成 `student_checkpoint: 我选择了...`，对 LLM 语义模糊
- prompt 没有任何"学生刚答了你的检查点"的引导，模型丧失对当前进度的判断

**修复**：
- 前端：`handleCheckpoint` 构造 `我在检查点「{q}」选了：{id} {text}` 作为 message 传给 `/chat/stream`
- 前端：`streamChat` 与 `ChatStreamRequest` schema 新增 `checkpoint_answer` 元数据
- 后端：`checkpoints.py` 删掉 `add_message(role="student_checkpoint", ...)`，避免污染历史；选择走标准 `student` role，metadata 里带 `checkpoint_answer` 标记
- 后端：`chat.py` 把 message 写入 student role 时把 `checkpoint_answer` 写进 `metadata_json`
- 后果：AI 上下文里全是干净 `student:` 消息，与手动输入同一条路径

### 放大 bug：local_demo 死循环

`apps/api/app/llm/provider.py:local_demo_response` 早期无视输入永远返回同一份 checkpoint JSON，本地用 local_demo 调试时一定死循环弹窗。改为识别 prompt 末尾"选了：..."，命中则推进到讲解并返回 `checkpoint: null`，专修此死循环。

### 全盘 JSON 会话日志（看卡点）

**痛点**：SQLite 只存净化后的 `turn.message`，丢失 LLM raw 返回、完整 prompt、是否走 fallback、检查点正误标签、耗时——后期"看卡点"无据可查。

**新增**：`apps/api/app/storage/session_logger.py` 提供 `SessionLogger`：
- 落点 `logs/sessions/<session_id>.jsonl`，一行一 JSON 事件，原子 append，崩溃只丢最后半行
- `tutor_turn` 事件：完整 prompt、raw_response（含 markdown/fence）、parsed_turn（**完整保留** checkpoint 的 `is_correct/misconception`）、latency_ms、parse_ok、used_fallback、error
- `checkpoint_answer` 事件：checkpoint_id / selected / is_correct / misconception / elapsed_ms / event / next_phase
- 写盘失败被兜住，绝不影响答疑主流程
- `config.py` 新增 `session_log_dir`（env `SESSION_LOG_DIR`，默认 `logs/sessions/`），`main.py` 注入 `app.state.session_logger`
- `chat.py` 传 logger 给 `generate_tutor_turn`；`checkpoints.py` 写 `checkpoint_answer` 日志
- SQLite 维持业务态主存储，互不干扰

### 真流式打字机 + 空响应抛错

**症状**：某次会话第 7 轮 GLM-5.2 思考 30 秒后返回空字符串，会话静默断流；学生体感是"反应很久然后没字"。

**根因**：
- 旧 `chat_completion` 非流式调用，必须等模型把整段 JSON 全算完才一次性返回
- GLM 带 thinking 的模型先内部推理 20-30 秒不吐 token，httpx 整体 `timeout_ms=30s` 一到就判超时
- 服务端虽算完但连接已断，`data["choices"][0]["message"]["content"]` 返回空串
- 旧代码没检查空 content、没看 finish_reason，静默返回空，外面不动也没报错

**修复**：
- `provider.py` 新增 `chat_stream_completion`：`stream: true` 接 SSE `data:` 行，yield `{"delta", "finish_reason"}`
- httpx read 超时按"两次 chunk 之间"计算而非整体 30s，第一个 token 几百毫秒就能到
- `_assert_nonempty` 把空响应转 `LlmProviderError`：`finish_reason="length"` 提示调大 `max_output_tokens`，其它情况提示"请重试或换一道题"
- `chat.py` 把空响应通过 SSE error 事件透传给前端，不再静默断流
- `provider.py:chat_completion` 重构为复用 streaming 流，向后兼容
- `provider.py:local_demo_stream` 把 local_demo 输出按 4 字一组切，模拟打字机

### 增量 JSON message 解析器

**新增**：`apps/api/app/core/streaming.py:MessageStreamExtractor`
- 流式识别 `"message":"..."` 字段开口后的可见字符
- 正确解码 `\n \t \r \" \\ \/ \uXXXX` 转义
- 跨 chunk 的半个转义（如 `\u4e2` + `d`）暂存等补全，不误吐脏字符
- 只解析 message 字段；结构化的 phase/checkpoint 仍等整段 raw 完整后用 `extract_json_object` 拿，避免边界污染

### teaching_controller 适配流式

`generate_tutor_turn_stream` 异步生成器：yield `("message_delta", 增量)` × N → 最后 yield `("turn", TutorTurn)`。`chat.py` 改用它，去掉旧的"收到完整 message 再切成 18 字一段假流式"逻辑——现在是真打字机。

SYSTEM_PROMPT 加规则 #7「不要在内部做冗长思考，直接产出最终 JSON」，缓解 GLM 长 thinking。

### 测试

- `tests/test_chat_flow.py` 新增：答完检查点 → 第二轮不再弹同一检查点且有可见讲解；UNKNOWN → recovering phase；messages 表不再出现 `student_checkpoint` role；SSE 真流式把 message 切成多段 delta 到达
- `tests/test_session_logger.py`（新增）：raw/fallback/完整 checkpoint 标签 jsonl 记录、checkpoint_answer 事件、多事件 jsonl 追加、写盘失败不抛
- `tests/test_streaming.py`（新增）：message 增量提取、转义引号 + `\u` 解码、跨 chunk 半个转义、local_demo 走流式
- 18 个测试全过，TS 类型检查通过

## v0.2 — 2026-07-07（更早）

初版诊断式教学 MVP：FastAPI + SQLite + Next.js，非流式 LLM 调用，OpenAI-compatible 模型配置加密存储。详见 git 历史。
