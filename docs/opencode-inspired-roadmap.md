# 诊断式数学答疑产品改造路线图

版本：v1.0
日期：2026-07-18
参考对象：OpenCode `dev@fab2133`

## 0. 当前实施状态

截至 2026-07-18，本路线图 P0 的五个工程包已经落地：Alembic/SQLite 可靠性基线、durable 输入与幂等提交、`session_events` 有序重放、`session_runs` 生命周期与显式中断、前端 reducer/stream controller 状态隔离。

当前边界是：后端 durable change feed 已可通过 `after_seq` / `Last-Event-ID` 重放，页面恢复仍采用“session 快照 + 本轮 chat SSE”；前端尚未把 durable events 订阅器接入页面时间线。因此这里记录的是已完成的 P0 工程范围，不把字符级流式输出声明为 exactly-once，也不把 P1 之后的上下文压缩、数学验证和评测能力标成已完成。

## 1. 改造目标

保留当前诊断式教学内核，不把产品改造成通用 Agent 平台。优先借鉴 OpenCode 在会话运行时、事件协议、上下文管理、模型适配和前端状态管理方面的设计，将当前 MVP 升级为一个：

- 可中断、可重试、可恢复的教学会话系统；
- 可重放、可审计的流式事件系统；
- 有明确上下文预算的长对话系统；
- 有独立数学正确性验证通道的教学系统；
- 前后端状态边界清晰、能够持续演进的本地产品。

当前教学 action 仍只保留：

- `ASK_OPEN_QUESTION`
- `ASK_MULTIPLE_CHOICE`
- `EXPLAIN_LOCAL`
- `EXPLAIN_PRINCIPLE`
- `RESPOND_TO_CHECKPOINT`
- `SUMMARIZE`

`wait_for_student` 继续由后端根据 action 推导；SQLite 继续作为 session 恢复的唯一权威来源。

## 2. 总体实施顺序

```text
P0：会话可靠性底座
  -> P1：模型适配、上下文与数学验证
  -> P2：教学评测与质量闭环
  -> P3：可选的平台化能力
```

不得跳过 P0 直接建设插件、多 Agent 或通用工具平台。后续阶段必须建立在前一阶段的数据协议和验收结果上。

## 3. P0：会话可靠性底座

### 3.1 目标

解决重复提交、页面刷新、网络断开、用户中止、并发输入和服务重启带来的状态不确定问题。

### 3.2 数据库迁移体系

引入正式数据库迁移工具，建议使用 Alembic，替代启动时不断追加 `_ensure_column()` 的方式。

需要完成：

1. 为现有 schema 建立初始迁移基线。
2. 为核心关系增加外键和必要索引。
3. 启用 SQLite foreign keys。
4. 评估并启用 WAL 与合理的 busy timeout。
5. 明确旧数据库升级、失败回滚和本地备份方式。

验收标准：

- 全新数据库能通过迁移一次创建；
- 现有数据库能无数据丢失升级；
- 重复执行迁移不会重复建表或破坏数据；
- session 删除后，不留下无主 message、checkpoint 或待归档 card。

### 3.3 输入接纳与模型执行分离

当前 `/api/chat/stream` 同时负责写入学生消息和执行模型。需要拆成两个概念：

1. **输入接纳**：先把用户输入可靠写入 SQLite。
2. **会话执行**：runner 从 SQLite 读取待处理输入并推进教学 action。

建议增加等价的数据结构：

```text
session_inputs
  id
  session_id
  client_message_id
  input_type
  payload_json
  admitted_seq
  promoted_seq
  status
  created_at
```

普通文本、checkpoint answer 和“关闭卡片后继续”都应形成明确、可审计的输入或控制命令，不能依赖前端隐式触发。

验收标准：

- 输入成功落库后，即使当前 HTTP 连接断开也不会丢失；
- runner 可以在没有原始请求连接的情况下继续读取待处理输入；
- 同一 session 同时只能有一个写入教学历史的 runner；
- 不同 session 可以并行执行。

### 3.4 幂等键与冲突检测

每次学生提交都携带前端生成的 `client_message_id`。服务端必须实现：

- 第一次提交：写入并返回接纳结果；
- 完全相同的重复提交：返回原接纳结果；
- 同一 ID 携带不同内容：返回明确的 `409 Conflict`；
- checkpoint answer：数据库层保证同一 checkpoint 只能成功回答一次。

建议为模型执行增加：

```text
run_id
attempt
status: queued|running|completed|failed|interrupted
started_at
completed_at
error_json
```

验收标准：

- 连续双击发送不会产生两条学生消息；
- 请求超时后安全重试不会重复触发教学 action；
- checkpoint 重复提交不会产生第二条 `CHECKPOINT_RESPONSE`。

### 3.5 可重放事件流

增加只追加的 `session_events` 表，事件至少包含：

```text
id
session_id
seq
type
data_json
created_at
```

建议的初始事件类型：

- `input_admitted`
- `run_started`
- `message_started`
- `message_delta`（可只做实时事件，不必全部长期保存）
- `message_completed`
- `tutor_action_committed`
- `checkpoint_ready`
- `checkpoint_answered`
- `card_ready`
- `card_saved`
- `run_failed`
- `run_interrupted`
- `session_idle`

SSE 事件必须带 `seq`。客户端保存最后处理的序号，重新连接时使用 `after_seq` 请求遗漏事件。

完整 assistant message、action、checkpoint、card 和错误结论必须有可重放的完成事件；高频文字 delta 可以只实时发送，重连后使用完整 message 完成事件恢复。

验收标准：

- 流式生成时刷新页面，重新进入 session 后能得到一致的最终时间线；
- SSE 断线重连不会重复展示已经处理的 checkpoint 或 card；
- 客户端重复收到同一 seq 时不会重复应用状态。

### 3.6 中断与恢复

增加 session run 的中断接口，例如：

```text
POST /api/sessions/{session_id}/interrupt
```

前端流式请求使用 `AbortController`，但客户端断开和服务端中断必须区分：

- 客户端只停止读取，不应自动假定服务端已经停止；
- 显式中断命令才改变 run 状态；
- 中断后已完整提交的 action 保留；
- 未完成的模型 step 记录为 interrupted，不伪装成完整 assistant message。

验收标准：

- 用户可以停止长时间生成；
- 停止后可以继续提交新消息；
- 中断不会留下永久占用的 active session；
- 服务重启后能识别遗留的 `running` 状态并安全标记失败或待恢复。

### 3.7 前端状态重构

把当前 `page.tsx` 中的会话状态和流式拼接逻辑迁移到 reducer/store。建议拆分：

```text
session-store
timeline-reducer
composer-controller
stream-controller
checkpoint-controller
card-controller
```

状态由服务端事件驱动，不允许多个互不关联的布尔值共同暗示一个隐含状态。

建议明确建模：

```text
composer: idle|submitting|queued|blocked
run: idle|connecting|streaming|interrupting|failed
checkpoint: none|pending|submitting|answered
card: none|pending_save|saving|saved
```

验收标准：

- reducer 有独立单元测试；
- 同一事件重复应用结果不变；
- 切换 session 时旧流不能写入新 session；
- checkpoint、card 和普通输入的阻塞关系由状态模型统一决定。

## 4. P1：模型适配、上下文与数学验证

### 4.1 目标

减少供应商差异对教学业务代码的污染，使长对话可持续运行，并为数学结论建立独立验证通道。

### 4.2 模型能力模型

把当前单一 `is_multimodal` 扩展为结构化能力描述：

```text
ModelCapabilities
  input_text
  input_image
  structured_output
  tool_calls
  context_window
  max_output_tokens
  streaming
```

可选增加价格信息，但本地 MVP 不应让价格模型阻塞主要改造。

session 创建时记录实际绑定的模型能力快照，防止后续修改 profile 后无法解释历史行为。

验收标准：

- 带题图的 session 只能绑定图片输入能力有效的模型；
- 上下文预算使用模型实际 context window，而不是统一常量；
- 不支持 structured output 或 tool calls 的模型自动走兼容降级路径。

### 4.3 统一模型事件适配层

业务层不再直接解析供应商 SSE。provider adapter 统一输出内部事件：

```text
text_delta
reasoning_delta（默认不展示、不写学生可见消息）
structured_result
usage
finish
provider_error
```

优先级：

1. 支持 JSON Schema structured output 的模型使用原生结构化输出；
2. 支持可靠 tool call 的模型可用单一 `emit_tutor_turn` 工具承载结构化参数；
3. 其他 OpenAI-compatible 模型继续使用当前 JSON 文本合同；
4. 当前 JSON 修复器仅作为兼容兜底，不再作为主协议。

验收标准：

- 教学控制器不依赖供应商原始 chunk 格式；
- provider error、finish reason 和 token usage 能统一记录；
- 非法结构化结果不会把半成品 action 写入业务历史。

### 4.4 上下文预算与自动压缩

当前完整历史继续永久保存在 SQLite，但模型每轮只读取活动上下文。

建议为每次模型请求计算：

```text
system tokens
history tokens
image/attachment estimate
reserved output tokens
safety buffer
```

超出预算时生成结构化教学摘要，至少保留：

- 原题与可靠识别结果；
- 学生初始思路；
- 已观察的学生证据；
- 已确认和已排除的误区；
- 已讲过的关键内容；
- checkpoint 结果；
- 当前卡点和未完成目标；
- 已归档卡片的必要引用；
- 会话末尾若干轮原文。

压缩结果必须落库并带版本、来源边界和生成时间。原消息不得删除。

验收标准：

- 长会话不会因为应用层无限追加历史而必然超窗；
- 压缩后模型仍能正确识别当前 checkpoint 和教学断点；
- 切换不同 context window 的模型时会重新计算预算；
- 压缩失败不会覆盖之前有效的上下文边界。

### 4.5 结构化学生状态

不要只依赖 `breakpoint_description` 和 `state_hint` 表示教学状态。增加结构化学生状态，例如：

```json
{
  "observed_evidence": [],
  "candidate_misconceptions": [],
  "ruled_out_misconceptions": [],
  "mastered_points": [],
  "open_questions": [],
  "current_breakpoint": null,
  "confidence": 0.0,
  "evidence_action_ids": []
}
```

该状态是教学决策的辅助投影，不代替原始消息和 checkpoint 事实。

验收标准：

- 每个诊断结论能追溯到具体 student message 或 checkpoint；
- 模型不能在没有新证据时静默把候选误区变成已确认误区；
- session 恢复和上下文压缩后仍保留相同证据关系。

### 4.6 数学验证工具

建立范围受控的教育工具注册表，不开放通用 shell 和文件写入。

第一批建议工具：

- 基础算术计算；
- 表达式化简与等价性判断；
- 方程求解与解代回验证；
- 最终答案验证；
- 条件与定义域检查；
- 必要时的课程知识点检索。

工具调用和结果应进入结构化 step/event，但默认不直接把内部验证过程展示给学生。

验证器的职责是发现数学风险，不负责决定教学 action。教学节奏仍由 Tutor Controller 管理。

验收标准：

- `SUMMARIZE` 前的关键公式和最终答案可以被独立验证；
- 验证失败时不能继续提交看似确定的 problem card；
- 工具不确定或不支持的题型会明确回退，而不是输出伪确定结论；
- 工具调用有超时、输入大小和次数限制。

## 5. P2：教学评测与质量闭环

### 5.1 目标

把当前依赖人工阅读 JSONL 的优化方式升级为可重复运行、可比较版本差异的教学评测体系。

### 5.2 固定回放集

建立版本化测试案例，至少覆盖：

- 学生完全没思路；
- 思路正确但计算错误；
- 概念理解错误；
- 过程正确但表达不完整；
- checkpoint 答对；
- checkpoint 答错；
- checkpoint 选择“我不知道”；
- 题图 OCR 有遗漏或错误；
- 模型输出非法 JSON；
- provider 超时或返回空内容；
- 长会话触发压缩；
- 页面刷新、断线重连和重复提交；
- 模型生成错误最终答案。

每个案例保存：

```text
输入材料
预期可接受诊断
禁止行为
允许的 action 范围
数学真值
关键 checkpoint 标准
最终卡片要求
```

### 5.3 评价指标

至少记录：

- 数学正确率；
- 卡点诊断准确率；
- 诊断结论的证据覆盖率；
- checkpoint 是否能区分具体误区；
- 是否过早泄露答案；
- 是否重复讲解；
- 是否出现不必要追问；
- 从错误或“不知道”恢复的成功率；
- action 合同违规率；
- 结构化输出失败率；
- 平均首字延迟、总延迟、token 和调用次数；
- 中断、重试和恢复成功率。

### 5.4 评测执行方式

建议分三层：

1. **确定性单元测试**：schema、状态转换、幂等、事件 reducer、数据库事务。
2. **录制回放测试**：固定模型响应，验证完整会话工作流。
3. **真实模型评测**：同一批教学案例对不同模型和 prompt 版本运行，输出对比报告。

真实模型评测结果必须记录模型 profile、prompt 版本、代码版本和随机性参数。

验收标准：

- 修改 system prompt 或 action 协议前后能生成可比较报告；
- 回归测试能发现重复 checkpoint、错误总结和状态死锁；
- 模型升级不能只依据页面体感决定。

## 6. P3：可选的平台化能力

只有 P0—P2 稳定后再评估以下能力。

### 6.1 内部角色分工

可以按需引入内部角色：

- Tutor：决定教学 action 和学生可见表达；
- Verifier：验证关键数学结论；
- Card Writer：在已有可靠结论基础上整理卡片。

这些角色不必成为用户可见的通用 Agent，也不应默认并发运行。Verifier 只在关键数学结论需要验证时触发，避免无意义增加成本和延迟。

### 6.2 学科技能包

当数学流程稳定并准备扩展年级或学科时，再设计受控的技能包，例如：

- 初中代数；
- 初中几何；
- 高中函数；
- 概率统计；
- 物理定量题。

技能包应提供课程知识、诊断策略和验证工具配置，不得绕过后端 action、等待和安全策略。

### 6.3 多用户与隐私

如果产品从本地单用户走向联网或多人使用，需要单独立项：

- 用户身份和数据隔离；
- 学生数据最小化；
- 题图和对话的保留期限；
- 日志脱敏；
- 删除与导出；
- 模型供应商数据边界；
- 未成年人隐私和监护人相关要求。

## 7. 明确暂不实施

当前阶段不做：

- 重写为 TypeScript、Bun 或 Effect；
- 通用 shell、任意文件写入和代码执行工具；
- 完整 MCP 平台；
- 插件市场；
- 用户任意创建 Agent；
- 为了形式上的多 Agent 而拆分每一个教学步骤；
- 把教学 action 改造成无约束的通用工具调用；
- 用 JSONL 或 Markdown 代替 SQLite 恢复业务状态；
- 删除完整历史来实现上下文压缩。

## 8. 推荐里程碑

### 里程碑 A：可靠提交

- 数据库迁移基线完成；
- 输入具有幂等 ID；
- checkpoint 防重复提交；
- run 状态可查询；
- 并发和重复请求测试通过。

### 里程碑 B：可恢复流

- session event 带序号；
- SSE 支持从 `after_seq` 重放；
- 支持中断；
- 页面刷新和断线恢复测试通过；
- 前端 reducer 完成。

### 里程碑 C：长会话与模型适配

- 模型能力结构化；
- provider 内部事件统一；
- token 预算和自动压缩上线；
- 结构化学生状态可追溯。

### 里程碑 D：数学正确性

- 第一批数学验证工具上线；
- 关键结论验证结果进入事件和日志；
- 错误结论不能进入最终 problem card；
- 覆盖主要初高中代数题型的回放集。

### 里程碑 E：评测驱动迭代

- 固定教学案例集完成；
- prompt、模型和代码版本可对比；
- CI 执行确定性测试和录制回放；
- 真实模型评测可生成版本报告。

## 9. 完成定义

本轮架构改造完成，不以“功能已经写完”为标准，而以以下结果为准：

1. 学生输入一旦被接纳，就不会因为连接中断而丢失。
2. 相同请求可以安全重试，不会产生重复消息、checkpoint 或 action。
3. 用户可以中断生成，并在明确状态下继续会话。
4. 客户端可以通过事件序号恢复一致的时间线。
5. 长会话有明确上下文预算和可靠压缩边界。
6. 关键数学结论拥有独立验证证据。
7. 教学诊断可以追溯到学生真实表现。
8. prompt、模型和代码变更能够通过统一评测比较效果。
