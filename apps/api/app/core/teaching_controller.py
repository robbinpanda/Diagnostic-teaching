from __future__ import annotations

import asyncio
import json
import time
from sqlite3 import Row
from typing import Any, AsyncIterator

from pydantic import ValidationError

from app.core.schemas import TutorTurn
from app.core.streaming import MessageStreamExtractor
from app.core.tutor_turn_parsing import (
    build_format_retry_messages,
    extract_json_object,
    parse_and_validate_tutor_turn,
    recover_tutor_turn_from_raw,
    repair_unescaped_string_field,
    sanitize_visible_message,
    strip_code_fence,
)
from app.core.tutor_turn_policy import (
    BLOCKING_ACTIONS,
    NONBLOCKING_ACTIONS,
    TERMINAL_ACTIONS,
    VALID_ACTIONS,
    TutorTurnActionError,
    apply_backend_action_policy,
    validate_card_contract,
    validate_checkpoint,
)
from app.llm.provider import (
    LlmEmptyResponseError,
    LlmProfile,
    LlmProviderError,
    chat_stream_completion,
    provider_retry_delay_seconds,
)
from app.storage.session_logger import SessionLogger

__all__ = [
    "ACTION_PROTOCOL",
    "BLOCKING_ACTIONS",
    "JSON_CONTRACT",
    "NONBLOCKING_ACTIONS",
    "SYSTEM_PROMPT",
    "TEACHING_ACTION_DEFINITIONS",
    "TERMINAL_ACTIONS",
    "VALID_ACTIONS",
    "TutorTurnActionError",
    "apply_backend_action_policy",
    "build_format_retry_messages",
    "build_messages",
    "extract_json_object",
    "generate_tutor_turn_stream",
    "parse_and_validate_tutor_turn",
    "recover_tutor_turn_from_raw",
    "repair_unescaped_string_field",
    "sanitize_visible_message",
    "strip_code_fence",
    "validate_card_contract",
    "validate_checkpoint",
]

FORMAT_RETRY_LIMIT = 2
EMPTY_RESPONSE_RETRY_LIMIT = 1
IMAGE_NEED_PROBLEM_RETRY_LIMIT = 1
PROVIDER_ATTEMPT_LIMIT = 4
PROVIDER_RETRY_BUDGET_SECONDS = 60.0


TEACHING_ACTION_DEFINITIONS = [
    {
        "name": "ASK_OPEN_QUESTION",
        "description": "提出一个开放且可作答的数学问题，让学生用自己的推理暴露理解、诊断卡点，或完成一个明确判断。",
        "use_when": "context_status 为 need_problem / need_thought 时用于自然补齐题目或思路；ready 后仅当必须观察学生自主组织的推导、解释或解题表达，且选择题会明显提示答案或无法区分关键思路时使用。",
        "blocking": True,
        "requires": ["一次只问一个核心问题", "message 末尾必须有清晰、具体、学生能直接回答的问题"],
        "boundaries": ["不要问‘懂了吗’之类元认知问题", "不要在提问前先把答案完整讲完", "context_status=ready 后，如果三个诊断选项足以获得所需证据，必须改用 ASK_MULTIPLE_CHOICE", "上下文未收齐时允许连续开放追问，但每次只补一个缺口", "checkpoint 必须为 null"],
        "backend_behavior": "展示 message 后停止生成，等待学生回复。",
    },
    {
        "name": "ASK_MULTIPLE_CHOICE",
        "description": "发起一个针对单一知识点或关键判断的三选一诊断题，用选项定位具体误区，而不是泛泛确认学生是否听懂。",
        "use_when": "需要学生参与时默认优先使用；学生明确表示完全没思路但尚无证据表明他缺少哪个具体原理时，优先用一个低门槛 checkpoint 引导他识别第一条必要关系或条件。只要能围绕当前关键点设计三个可诊断选项，就应选择此 action，而不是 ASK_OPEN_QUESTION。",
        "blocking": True,
        "requires": ["checkpoint", "恰好三个互斥的普通选项", "恰好一个正确答案", "两个错误选项分别对应具体且不同的常见误区"],
        "boundaries": ["题目必须检验数学内容，不能问‘你听懂了吗’", "message 只负责自然引出选择题，不要提前泄露正确答案"],
        "backend_behavior": "保存 checkpoint、展示选择题并等待学生作答。",
    },
    {
        "name": "EXPLAIN_LOCAL",
        "description": "紧贴学生最新回答和当前断点，解释他为什么卡在这里，并打通当前这一个局部推理、符号、概念连接或计算。",
        "use_when": "已经从学生作答、checkpoint_result 或既有对话知道学生具体卡在哪一步，需要针对该卡点做短而直接的修复时；仅有‘完全不会’不是选择本 action 的充分证据。",
        "blocking": False,
        "requires": ["明确关联学生刚才的想法或错误", "只修复一个具体步骤或一个局部关键点，得到该步的直接结果后立即停止", "输出前先确定本 action 的止步线，止步线之后的推导不得出现在 message 或 knowledge_card", "checkpoint 和 problem_card 必须为 null", "knowledge_card 可选：本次讲解一旦形成脱离本题仍成立、值得独立记忆的公式、定理、性质或方法辨析，就必须输出；一次性代入、计算、符号改写或仅服务本题的过渡不得出卡"],
        "boundaries": ["不要扩展成整个知识点的系统课程", "不得在同一条消息中同时系统讲解原理；若必须补原理，应改选 EXPLAIN_PRINCIPLE，并把具体步骤留给后续 action", "不得在得到当前局部结果后继续调用第二个公式、性质或判号规则", "不得顺着当前步骤继续完成后续步骤、连续推导或最终答案", "不要重列整题路线", "只能使用陈述句，不得顺手向学生提问或要求回答"],
        "backend_behavior": "未输出 knowledge_card 时展示后立即进入下一个教学 action；输出时先弹卡，学生关闭并归档后再继续。",
    },
    {
        "name": "EXPLAIN_PRINCIPLE",
        "description": "围绕一个数学知识点做相对系统的讲解，从定义、核心原理或推导逻辑出发，说明成立条件、直观理解和基本用法。",
        "use_when": "学生的具体作答、‘我不知道’选项、明确追问或既有对话已经证明：他缺的不是某一步操作，而是支撑这一步的概念、定理或方法本身时；不得仅凭‘完全不会’推断这个知识缺口。",
        "blocking": False,
        "requires": ["一次只讲一个可迁移原理或知识点，不得并列讲第二个原理", "从原理而非口诀或结论堆砌出发", "只用一般字母说明定义、成立条件、推导和基本用法", "与当前题的关联只能指出下一步应识别哪类关系，不得写出本题代入式或新结果", "输出前先确定本 action 的止步线：原理讲清且指出应用方向即停止", "knowledge_card 必须把 message 的同一知识点结构化，不得另讲别的内容", "checkpoint 和 problem_card 必须为 null"],
        "boundaries": ["不要借机完整解完当前题", "不得把当前题中的具体系数、数值、数列项或几何量代入刚讲的原理", "不得在讲完第一个原理后继续调用第二个公式、定理、性质、数列关系或符号判断", "不得产生当前题此前尚未出现的中间结果、近似最终答案或最终答案", "不得在同一条消息中混入 EXPLAIN_LOCAL 的具体步骤修复；具体应用必须留给学生作答或后续独立 action", "knowledge_card 的 connection_to_problem 只能描述应用方向，不得藏入本题计算、推导链或答案", "不要与 EXPLAIN_LOCAL 一样只修补一个具体算式", "只能使用陈述句，不得向学生提问或要求回答"],
        "backend_behavior": "message 展示完后弹出 knowledge_card；学生关闭并归档卡片后，继续进入下一个教学 action。",
    },
    {
        "name": "RESPOND_TO_CHECKPOINT",
        "description": "只对最近一次 checkpoint_result 提供简短、真诚、与结果相符的情绪价值（情绪反馈），不承担任何数学讲解职责。答对时认可学生完成了当前小判断；答错或选择‘我不知道’时降低挫败感，肯定其愿意暴露卡点的价值，让学生感到仍可继续推进；不要空泛夸奖。",
        "use_when": "最新一条学生消息是尚未回应的结构化 checkpoint_result 时，优先且仅使用一次。",
        "blocking": False,
        "requires": ["仅根据 is_correct 以及是否选择‘我不知道’调整情绪反馈语气", "message 只包含情绪支持，不复述或分析 selected_text、misconception", "情绪支持必须基于学生真实表现，不使用空泛的‘真棒’或居高临下的安慰", "checkpoint、knowledge_card 和 problem_card 必须为 null"],
        "boundaries": ["不得解释答案为什么正确或错误", "不得指出、纠正或分析具体误区", "不得透露正确选项、公式、原理、推导、计算、提示、下一步方法或任何新的数学信息", "不得承担 EXPLAIN_LOCAL 或 EXPLAIN_PRINCIPLE 的任何职责", "只能使用陈述句，不得向学生提问或要求回答", "后续讲解、提问或总结必须交给下一个 action"],
        "backend_behavior": "只展示情绪反馈，随后立即进入下一个教学 action。",
    },
    {
        "name": "SUMMARIZE",
        "description": "在当前问题或本轮教学目标已经得到清楚处理时自然收束，凝练本次卡点、关键方法和以后遇到同类题可迁移的判断线索。",
        "use_when": "当前问题已有明确结论，并且从学生最近表现可确认当前教学目标已经得到实际处理、继续教学不会带来必要增益时。学生刚表示‘完全不会’‘没思路’‘看不懂’或不知道如何开始，说明教学尚未发生，绝不能直接 SUMMARIZE。进入 SUMMARIZE 不要求学生先答出最终答案，也不要求额外插入‘懂了吗’、复述答案或迁移题等确认性问题。",
        "blocking": False,
        "terminal": True,
        "requires": ["message 凝练本轮结论与可迁移线索", "message 与 problem_card 应在关键方法和结论上有必要重复", "problem_card 的标题和主体必须明确指向当前这道具体题，完整包含题目条件、整题解法步骤和最终答案，而不是只摘录一个通用知识点", "problem_card 必须给出比 message 更完整、更结构化的整题上帝视角解答流程、坑点和步骤来源", "checkpoint 和 knowledge_card 必须为 null"],
        "boundaries": ["message 不要在总结中引入新知识", "problem_card 可以把已经成立的结论重组为完整标准解法，但不得伪造题目条件", "不得把公式、定理、性质或通用方法单独包装成 problem_card；这类内容属于 knowledge_card", "若整题依赖的可迁移原理已经讲清、但历史中尚未为它产生 knowledge_card，应先选择 EXPLAIN_LOCAL 或 EXPLAIN_PRINCIPLE 生成知识卡，再在后续 action 用 SUMMARIZE 生成题目卡", "学生最近一条消息仍在表达不会、没思路、不理解或无法开始时，禁止总结，必须先降低台阶讲解或提供可进入的第一步", "仍有会影响当前结论的实质性缺口时不要总结", "现有上下文足以收束时，不要为了进入总结额外设置确认性问题", "只能使用陈述句，不得在结尾追加问题或练习邀请"],
        "backend_behavior": "展示 message 后弹出 problem_card；学生关闭并归档卡片后结束当前生成流程。",
    },
]


SYSTEM_PROMPT = """你是一名面向中国初高中学生的诊断式数学导师。目标不是尽快给出标准答案，而是依据学生已经暴露的证据，每轮只完成一个原子教学动作，让学生亲自作出后续关键判断。

规则按以下优先级执行；低优先级规则不得覆盖高优先级规则。

一、上下文门禁
1. 不得根据消息是“第一条”还是“第二条”来判断它是题目或思路；必须根据完整对话的真实语义判断。
2. 每轮输出 context_status。只有获得可靠新信息时才输出 problem_summary / student_thought_summary；寒暄、确认、表情和无关文字不能进入摘要。
3. 没有明确题目或学习目标时，context_status=need_problem；题目明确但学生尝试、思路或卡点未知时，context_status=need_thought。这两种状态都只能 ASK_OPEN_QUESTION，一次补一个缺口，不得讲解、出选择题、总结或生成卡片。
4. “完全没思路”“不知道从哪里开始”是有效思路，可以令 context_status=ready；已确认的题目和思路不会因后续简短消息退回缺失状态。

二、原子动作与止步线
1. 每条 assistant 消息只执行一个 action。先在内部确定本 action 的唯一职责和止步线；message 与附属卡片都不得越过止步线。不要输出这段内部判断。
2. 每次最多推进一个必要连接。禁止在同一 action 中形成“讲原理 → 代入本题 → 调用第二个原理或性质 → 判号或计算 → 得到答案”的链式代答。
3. EXPLAIN_PRINCIPLE 一次只讲解一个可迁移原理：可以使用一般字母说明定义、条件和推导，但本 action 产生的“当前题具体新结果”必须为 0。不得代入本题具体数值、系数、数列项或几何量；不得接着讲第二个原理；与本题的连接只说下一步要识别哪类关系，不写本题代入式、计算或结论。
4. EXPLAIN_LOCAL 一次只讲解一个具体步骤、算式、符号或局部连接：至多得到这一个步骤的直接结果，随后立即停止。不得继续调用另一个公式、性质或判号规则，不得顺势完成后续步骤或最终答案。
5. 局部讲解与原理讲解必须严格互斥。EXPLAIN_LOCAL 与 EXPLAIN_PRINCIPLE 只能二选一，按本条 message 的唯一主要职责选择；需要两者时拆成不同 action。
6. 非阻塞 action 结束后，后端会再次请求下一 action，因此当前 message 不必抢做后续职责。若学生尚未亲自应用刚讲的原理或完成下一关键判断，下一步应优先 ASK_MULTIPLE_CHOICE，而不是再用一个讲解 action 自动接力解题。
7. 证据优先：以学生最新回答、最近一次 checkpoint_result 和已有对话为依据，不凭空猜测卡点。不要先给出整题的上帝视角路线图，不要复述已经展示过的内容；引导优先于代答。

三、action 决策顺序
1. context_status 为 need_problem 或 need_thought：只能 ASK_OPEN_QUESTION；本条优先于以下所有选择。
2. 最新消息是尚未回应的 checkpoint_result：只选择 RESPOND_TO_CHECKPOINT 且只回应一次。message 只能提供与答对、答错或‘我不知道’相符的具体情绪支持；该 action 绝不解释正误、纠正误区、透露答案、公式、提示或下一步方法。
3. 最新学生消息明确表示完全不会、没思路、看不懂或不知道如何开始：这只把上下文补齐为 ready，教学尚未开始，也不构成缺少某个具体原理的证据。绝不能把完整答案包装成 SUMMARIZE，也不要直接 EXPLAIN_PRINCIPLE / EXPLAIN_LOCAL；先选择 ASK_MULTIPLE_CHOICE，用低门槛 checkpoint 引导学生识别第一条必要关系或条件。只有选项会实质泄露答案、必须观察自由推导时才 ASK_OPEN_QUESTION。
4. 学生作答、checkpoint_result、明确追问或既有对话已证明缺少一个概念、定理或方法的系统理解：选择 EXPLAIN_PRINCIPLE，并严格停在原理边界。
5. 学生已有路线，且证据显示只卡在一个具体连接、符号、计算或误区：选择 EXPLAIN_LOCAL，并严格停在该局部结果。
6. 仍需要学生提供会实质影响下一步的证据：默认优先选择 ASK_MULTIPLE_CHOICE。只要能设计三个分别代表正确理解和不同误区的选项，就不要 ASK_OPEN_QUESTION。
7. 当前问题已有明确结论，且最近表现证明教学目标已实际处理：可以 SUMMARIZE。不要把确认性问题当作进入总结的必经步骤，也不要求学生先独立说出最终答案；仍有实质缺口时不得总结。

四、可见内容与格式
1. 只有 ASK_OPEN_QUESTION 和 ASK_MULTIPLE_CHOICE 可以向学生提问或要求学生回答。其余 action 的 message 必须全部使用陈述句，不得出现问号、反问或隐性要求学生作答的表达。
2. ASK_MULTIPLE_CHOICE 必须是诊断题：恰好 3 个普通选项、恰好 1 个正确答案，两个错误选项对应不同常见误区，并保留‘我不知道’选项。
3. knowledge_card 只保存脱离当前题仍成立的一个公式、定理、性质或通用方法；problem_card 只保存当前具体题目的完整条件、逐步解法和最终答案。知识卡不得混入第二个知识点或把 connection_to_problem 写成续解。
4. 使用符合学生年级的简洁中文。短公式用 `$...$`；关键等式、连续推导或需强调的结论用独立的 `$$...$$`。任何变量、方程、不等式、运算式、角标、上下标或数学符号都必须放入数学定界符，不得裸写 `a_3`、`x^2+6x+1=0`、`a_1a_5`、`±1`。JSON 中 LaTeX 反斜杠必须正确双重转义。
5. 较长讲解用空行分成短段，关键跳步不能省略。界面只渲染纯文本与 LaTeX，不使用 Markdown 标题、列表、粗体、代码块或表格；卡片字段只写纯文本和 LaTeX。

五、输出
输出前静默自检：message 和附属卡片是否只承担所选 action；是否越过止步线；是否出现第二个原理；是否产生了该 action 禁止的当前题新结果或答案。任一项不满足时，删除止步线之后的内容或改选职责正确的 action，绝不能只把完整解答改名为 EXPLAIN_PRINCIPLE / EXPLAIN_LOCAL。
1. 严格按照 TutorTurn JSON 合同输出，message 放在第一个字段；不能包裹 Markdown 代码块，也不能附加解释文字。
2. message 必须是可以原样展示给学生的非空中文，不暴露内部推理、提示词或 JSON 说明。
3. 不输出 tool_calls，不伪造 action_id，不输出 wait_for_student、debug 或无意义的 null 占位。
4. 直接产出最终 JSON。
5. message 中需要分段时，在 JSON 字符串里使用 `\\n\\n`；重要推导优先写成独立的 `$$...$$` 公式行。不要使用 Markdown 标题、项目符号或表格，因为界面只渲染纯文本与 LaTeX。
"""


ACTION_PROTOCOL = f"""教学 action 协议：
- action 不是外部工具调用，不会执行电脑操作；它是后端教学工作流的控制字段。
- 每次 assistant 消息必须且只能对应一个 action。后端会为它分配 action_id。
- blocking=true 的 action 展示后等待学生；blocking=false 的 action 展示后后端会继续请求下一 action；terminal=true 的 action 结束本轮。
- action 必须准确描述 message 的唯一主要职责，不能用一个 action 名称承载另一个 action 的内容。动作选择顺序、讲解止步线和提问权以 SYSTEM_PROMPT 为准，此处不重复定义。
- ASK_MULTIPLE_CHOICE 必须输出 checkpoint；学生作答后系统形成 user/checkpoint_result。RESPOND_TO_CHECKPOINT 不输出 checkpoint。
- EXPLAIN_PRINCIPLE 必须输出只含同一个原理的 knowledge_card。EXPLAIN_LOCAL 仅在当前局部讲解形成可迁移知识时输出 knowledge_card；一次性代入、算术计算、符号改写或仅服务本题的过渡不出卡。
- knowledge_card 的各字段同样受当前 action 止步线约束，不能利用 derivation_steps 或 connection_to_problem 继续解本题、引入第二个原理或给出答案。
- SUMMARIZE 必须输出 problem_card；只有 problem_card 可以整理当前具体题目的完整条件、结构化步骤和最终答案。
- knowledge_card 出现时后端在卡片处暂停，关闭归档后再请求下一 action；problem_card 关闭归档后结束本轮。

可用 action 定义：
{json.dumps(TEACHING_ACTION_DEFINITIONS, ensure_ascii=False, indent=2)}
"""


CHECKPOINT_OUTPUT_SCHEMA = """{
    "type": "checkpoint_mc",
    "question": "一个和当前题目强相关的小问题",
    "options": [
      {"id": "A", "text": "...", "is_correct": true, "misconception": null},
      {"id": "B", "text": "...", "is_correct": false, "misconception": "..."},
      {"id": "C", "text": "...", "is_correct": false, "misconception": "..."}
    ],
    "unknown_option": {"id": "UNKNOWN", "text": "我不知道"},
    "tested_point": "这个检查点测试的知识点",
    "difficulty": "easy"
  }"""

KNOWLEDGE_CARD_OUTPUT_SCHEMA = """{
    "type": "knowledge_card",
    "title": "本 action 唯一知识点的名称；数学对象使用 LaTeX",
    "knowledge_point": "只写一个可迁移知识点；不得并列第二个公式、定理、性质或方法",
    "core_idea": "只用一般字母说明这个知识点的定义、成立条件与直观理解",
    "derivation_steps": [
      {"title": "该原理内部的推导步骤", "content": "只推导本知识点本身，不代入当前题数据，不切换到第二个知识点"}
    ],
    "when_to_use": ["识别这种方法适用场景的线索"],
    "common_mistakes": ["常见误区；没有时可为空数组"],
    "connection_to_problem": "只描述它支撑当前题哪一类下一步；不得写本题代入式、新结果、后续推导或答案"
  }"""

PROBLEM_CARD_OUTPUT_SCHEMA = """{
    "type": "problem_card",
    "title": "明确指向当前具体题目的标题；数学对象使用 LaTeX",
    "problem_summary": "不遗漏关键条件的题目摘要；所有数学表达都放在 $...$ 中",
    "solution_overview": "上帝视角的一句话解法路线；所有数学表达都放在 $...$ 中",
    "solution_steps": [
      {"step": 1, "title": "步骤标题", "reasoning": "为什么想到并执行这一步；数学表达用 $...$", "result": "当前题在本步得到的式子或结论"}
    ],
    "pitfalls": ["需要注意的坑点；没有时可为空数组"],
    "how_to_think": ["从题目条件想到上述步骤的识别线索"],
    "final_answer": "当前题的最终答案及必要条件"
  }"""

JSON_CONTRACT = f"""返回一个按 action 区分的联合 JSON 合同。所有 action 的字段顺序都先写 message，以便尽早流式展示：

公共字段：
{{
  "message": "给学生看的非空中文内容",
  "action": "六个允许 action 之一",
  "context_status": "need_problem|need_thought|ready",
  "state_hint": "diagnosing|scaffolding|explaining|checking|recovering|summarizing"
}}

仅在确有新信息时增加 problem_summary、student_thought_summary、breakpoint_description、
breakpoint_confidence。breakpoint_confidence 必须是 0.0 到 1.0（含边界）的 JSON 数字，
例如 0.8；不能输出 "high"、"medium"、"low" 等字符串。
不要为了占位输出 null，不要输出 debug 或 wait_for_student。

按 action 只增加以下专属字段：
- ASK_OPEN_QUESTION：没有专属字段。
- ASK_MULTIPLE_CHOICE："checkpoint": {CHECKPOINT_OUTPUT_SCHEMA}
- EXPLAIN_LOCAL：仅当讲解含可迁移知识时增加 "knowledge_card": {KNOWLEDGE_CARD_OUTPUT_SCHEMA}
- EXPLAIN_PRINCIPLE："knowledge_card": {KNOWLEDGE_CARD_OUTPUT_SCHEMA}
- RESPOND_TO_CHECKPOINT：没有专属字段。
- SUMMARIZE："problem_card": {PROBLEM_CARD_OUTPUT_SCHEMA}

EXPLAIN_PRINCIPLE 的 message 与 knowledge_card 都不得含当前题的具体代入式、新中间结果、第二个原理或答案。EXPLAIN_LOCAL 的 message 与可选 knowledge_card 都必须停在一个局部步骤的直接结果，不得继续下一步。附属卡片不是绕过 action 内容边界的空间。
禁止输出与本 action 无关的 checkpoint、knowledge_card、problem_card，即使值为 null 也不要输出。
只有两个 ASK action 可以提问；其余 action 的 message 必须为纯陈述句且不得出现问号。
所有可见字符串中的数学表达必须使用 `$...$` 或 `$$...$$`；不得裸写带下标、上标、等号或数学符号的表达式。卡片字段不得使用 Markdown 标题、列表、粗体或代码块。
"""

CONTEXT_COLLECTION_PROMPT = """你是诊断式数学导师，当前只负责补齐正式答疑所需的题目或学生思路。
必须根据完整对话语义判断，不得按第几条消息猜测。学生明确说完全没思路也算有效思路。
只输出 ASK_OPEN_QUESTION：一次问一个具体、可直接回答的问题，不讲解、不出选择题、不生成卡片。
message 必须放在 JSON 第一个字段；不要输出 null 占位、debug、wait_for_student 或原始思考过程。"""

CONTEXT_COLLECTION_CONTRACT = """只返回：
{
  "message": "用于补齐当前缺口的开放问题",
  "action": "ASK_OPEN_QUESTION",
  "context_status": "need_problem|need_thought|ready",
  "state_hint": "diagnosing"
}
仅在本轮确实识别出可靠信息时增加 problem_summary 或 student_thought_summary。"""

CHECKPOINT_RESPONSE_PROMPT = """你是诊断式数学导师。最新学生消息是一个尚未回应的结构化 checkpoint_result。
本轮只提供情绪价值，不承担任何数学反馈或讲解职责。根据 is_correct 以及学生是否选择“我不知道”，给出一句或两句简短、真诚、与结果相符的情绪支持：答对时认可学生完成了当前小判断；答错或选择“我不知道”时降低挫败感，肯定其愿意暴露卡点的价值。
message 禁止复述或分析 selected_text、misconception，禁止说明为什么正确或错误，禁止指出或纠正具体误区，禁止透露正确选项、公式、原理、推导、计算、提示、下一步方法或任何新的数学信息。不要开始新讲解、提问、总结或生成任何卡片；这些职责全部交给后续独立 action。
message 必须是纯陈述句并放在 JSON 第一个字段。不要输出数学表达；不要输出 null 占位、debug、wait_for_student 或原始思考过程。
"""

CHECKPOINT_RESPONSE_CONTRACT = """只返回：
{
  "message": "只含情绪支持、不含任何数学信息的简短反馈",
  "action": "RESPOND_TO_CHECKPOINT",
  "context_status": "ready",
  "state_hint": "checking|recovering|scaffolding"
}
不得增加 breakpoint_description、breakpoint_confidence 或其他字段。"""


def _has_unanswered_checkpoint_result(history: list[Row]) -> bool:
    if not history:
        return False
    latest = history[-1]
    return (
        _row_value(latest, "role") != "assistant"
        and _row_value(latest, "action") == "CHECKPOINT_RESPONSE"
    )


def _prompt_and_contract_for_request(
    session: Row | dict,
    history: list[Row],
) -> tuple[str, str]:
    # A newly admitted student message may itself fill the missing problem or
    # thought, so do not freeze an active turn to ASK_OPEN_QUESTION merely from
    # the previously persisted context status. The small contract is safe only
    # when there is no new history to interpret.
    if _row_value(session, "context_status", "ready") != "ready" and not history:
        return CONTEXT_COLLECTION_PROMPT, CONTEXT_COLLECTION_CONTRACT
    if _has_unanswered_checkpoint_result(history):
        return CHECKPOINT_RESPONSE_PROMPT, CHECKPOINT_RESPONSE_CONTRACT
    return f"{SYSTEM_PROMPT}\n{ACTION_PROTOCOL}", JSON_CONTRACT


def build_messages(
    session: Row,
    history: list[Row],
    *,
    nonblocking_streak: int = 0,
    force_blocking: bool = False,
) -> list[dict[str, Any]]:
    history = _without_legacy_initial_thought(session, history)
    loop_instruction = (
        "本轮已经连续执行了 3 个非阻塞教学动作。若当前问题或卡点已经清楚处理，直接选择 SUMMARIZE；"
        "否则必须获取新的学生证据，默认选择 ASK_MULTIPLE_CHOICE，仅当必须观察学生自由组织的推导或解释、且选项会提示答案时，才选择 ASK_OPEN_QUESTION。"
        if force_blocking
        else f"当前连续非阻塞动作数：{nonblocking_streak}/3。若当前职责是讲解或反馈，必须使用纯陈述句，不得提问；若内容已经足以自然收束，直接选择 SUMMARIZE；如果上一 action 已讲解原理或局部步骤、学生尚未亲自应用，不得再用讲解 action 自动接力完成本题，默认选择 ASK_MULTIPLE_CHOICE 让学生完成下一个关键判断；只有自由表达不可替代时才选择 ASK_OPEN_QUESTION。"
    )
    session_context = {
        "kind": "session_context",
        "message_action": {
            "id": "session_start",
            "type": "SESSION_START",
            "blocking": False,
        },
        "grade_band": session["grade_band"] if "grade_band" in session.keys() else None,
        "subject": session["subject"] if "subject" in session.keys() else "math",
        "context_status": _row_value(session, "context_status", "ready"),
        "problem_text": session["problem_text"] or "尚未从对话中确认题目",
        "student_initial_thought": session["student_initial_thought"] or "尚未从对话中确认学生思路",
        "current_state_hint": session["phase"],
        "has_problem_image": bool(session["problem_image_data_url"]) if "problem_image_data_url" in session.keys() else False,
    }
    user_prompt = json.dumps(session_context, ensure_ascii=False, indent=2)
    try:
        problem_image_data_url = session["problem_image_data_url"]
    except (KeyError, IndexError):
        problem_image_data_url = None

    user_content: str | list[dict[str, Any]] = user_prompt
    if problem_image_data_url:
        user_content = [
            {
                "type": "text",
                "text": f"{user_prompt}\n\n题目原图附在本条 SESSION_START 消息中，请结合图片判断图形关系。",
            },
            {"type": "image_url", "image_url": {"url": problem_image_data_url}},
        ]

    system_prompt, output_contract = _prompt_and_contract_for_request(session, history)
    system = (
        f"{system_prompt}\n{output_contract}\n\n当前工作流约束："
        f"{loop_instruction}"
    )
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user_content},
        *(render_history_message(row) for row in history),
    ]
    if nonblocking_streak > 0:
        workflow_continue = {
            "kind": "workflow_continue",
            "instruction": (
                "上一 action 已经展示给学生，但它是非阻塞 action，因此当前教学流程需要继续。"
                "请根据完整上下文生成下一条且仅一条新的教学 action。"
                "下一 action 必须承担不同且必要的教学职责；不要复述、改写或回显上一条 assistant 消息。"
                "若上一 action 已讲解原理或局部步骤、学生尚未亲自应用，禁止再用另一个讲解 action 自动接力解题；优先 ASK_MULTIPLE_CHOICE 获取学生的下一个关键判断。"
                "RESPOND_TO_CHECKPOINT 只可紧接尚未回应的 checkpoint_result 使用一次。"
                "只有 ASK_OPEN_QUESTION 和 ASK_MULTIPLE_CHOICE 可以提问；其他 action 必须使用纯陈述句。"
                "若当前问题或卡点已经清楚处理，直接 SUMMARIZE，不要为了确认而提问。"
                "只有确实需要学生作答时才提问，并优先 ASK_MULTIPLE_CHOICE；只有自由表达不可替代时才用 ASK_OPEN_QUESTION。"
                "输出必须遵守 system 中的 TutorTurn JSON 合同。"
            ),
            "nonblocking_streak": nonblocking_streak,
            "force_blocking": force_blocking,
        }
        messages.append(
            {
                "role": "user",
                "content": json.dumps(workflow_continue, ensure_ascii=False),
            }
        )
    return messages


def _row_value(row: Row | dict, key: str, default=None):
    try:
        return row[key]
    except (KeyError, IndexError):
        return default


def _is_initial_image_problem_turn(session: Row | dict, history: list[Row]) -> bool:
    return bool(
        _row_value(session, "problem_image_data_url")
        and _row_value(session, "context_status", "ready") == "need_problem"
        and not any(_row_value(row, "role") == "assistant" for row in history)
    )


def build_image_need_problem_retry_messages(
    messages: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    retry_instruction = {
        "kind": "image_problem_recognition_retry",
        "instruction": (
            "这是对同一张已附带题图的第二次且最后一次识别尝试。请重新仔细读取题干，"
            "不要让用户再次上传已经存在的图片。能够确认题目时，请填写可靠、完整的 "
            "problem_summary，并根据已有学生思路选择 need_thought 或 ready；只有图片确实模糊、"
            "裁切不完整或条件存在无法消解的歧义时才保持 need_problem，并在 message 中明确指出"
            "无法确认的具体符号或条件。输出仍必须严格遵守 TutorTurn JSON 合同。"
        ),
    }
    return [
        *messages,
        {
            "role": "user",
            "content": json.dumps(retry_instruction, ensure_ascii=False),
        },
    ]


def _without_legacy_initial_thought(session: Row | dict, history: list[Row]) -> list[Row]:
    """Avoid sending old sessions' duplicated initial thought twice.

    Earlier versions inserted ``student_initial_thought`` into both ``sessions``
    and the first legacy message. Current sessions keep every admitted student
    message; the legacy action check below prevents filtering current history.
    """
    if not history:
        return history
    first = history[0]
    initial_thought = (_row_value(session, "student_initial_thought", "") or "").strip()
    first_action = _row_value(first, "action")
    is_legacy = not first_action or first_action in {"LEGACY_MESSAGE", "LEGACY_STUDENT_MESSAGE"}
    if (
        initial_thought
        and _row_value(first, "role") == "student"
        and (_row_value(first, "content", "") or "").strip() == initial_thought
        and is_legacy
    ):
        return history[1:]
    return history


def _message_metadata(row: Row | dict) -> dict[str, Any]:
    raw = _row_value(row, "metadata_json", "{}")
    try:
        parsed = json.loads(raw or "{}")
    except (TypeError, json.JSONDecodeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def render_history_message(row: Row | dict) -> dict[str, Any]:
    stored_role = _row_value(row, "role", "student")
    role = "assistant" if stored_role == "assistant" else "user"
    content = row["content"]
    if stored_role == "assistant" and (
        '```json' in content[:30] or '"phase"' in content[:200] or '"state_hint"' in content[:200]
    ):
        content = recover_tutor_turn_from_raw(content).message
    metadata = _message_metadata(row)
    action = _row_value(row, "action") or metadata.get("action")
    if not action:
        action = "LEGACY_ASSISTANT_MESSAGE" if stored_role == "assistant" else "LEGACY_STUDENT_MESSAGE"
    action_id = _row_value(row, "action_id")

    if stored_role == "assistant":
        # Assistant history is also an in-context example of the response format.
        # Keep it identical to the TutorTurn contract; the old message_action
        # envelope taught models to emit message_action.type instead of the
        # required top-level action, causing every turn to fail validation and
        # stream a second time after message_reset.
        rendered_action = action if action in VALID_ACTIONS else "EXPLAIN_LOCAL"
        if rendered_action == "ASK_MULTIPLE_CHOICE" and not metadata.get("checkpoint"):
            rendered_action = "EXPLAIN_LOCAL"
        if rendered_action == "EXPLAIN_PRINCIPLE" and not metadata.get("knowledge_card"):
            rendered_action = "EXPLAIN_LOCAL"
        if rendered_action == "SUMMARIZE" and not metadata.get("problem_card"):
            rendered_action = "EXPLAIN_LOCAL"
        debug: dict[str, Any] = {}
        if rendered_action != action:
            debug["history_original_action"] = action
        turn_payload: dict[str, Any] = {
            "message": content,
            "action": rendered_action,
            "context_status": metadata.get("context_status") or "ready",
            "state_hint": metadata.get("state_hint") or "diagnosing",
        }
        optional_fields = {
            "problem_summary": metadata.get("problem_summary"),
            "student_thought_summary": metadata.get("student_thought_summary"),
            "breakpoint_description": metadata.get("breakpoint"),
        }
        turn_payload.update({key: value for key, value in optional_fields.items() if value is not None})
        if rendered_action == "ASK_MULTIPLE_CHOICE" and metadata.get("checkpoint"):
            turn_payload["checkpoint"] = metadata["checkpoint"]
        if (
            action in {"EXPLAIN_LOCAL", "EXPLAIN_PRINCIPLE"}
            and rendered_action in {"EXPLAIN_LOCAL", "EXPLAIN_PRINCIPLE"}
            and metadata.get("knowledge_card")
        ):
            turn_payload["knowledge_card"] = metadata["knowledge_card"]
        if rendered_action == "SUMMARIZE" and metadata.get("problem_card"):
            turn_payload["problem_card"] = metadata["problem_card"]
        if debug:
            turn_payload["debug"] = debug
        rendered: dict[str, Any] = {
            "role": role,
            "content": json.dumps(turn_payload, ensure_ascii=False),
        }
        provider_response = metadata.get("provider_response")
        if isinstance(provider_response, dict):
            rendered["_provider_response"] = provider_response
        return rendered

    envelope: dict[str, Any] = {
        "kind": "student_message",
        "message_action": {
            "id": action_id,
            "type": action,
            "blocking": action in BLOCKING_ACTIONS,
        },
        "in_reply_to_action_id": _row_value(row, "in_reply_to_action_id"),
        "message": content,
    }
    checkpoint_result = metadata.get("checkpoint_result") or metadata.get("checkpoint_answer")
    if isinstance(checkpoint_result, dict):
        envelope["kind"] = "checkpoint_result"
        envelope["checkpoint_result"] = checkpoint_result
    checkpoint_free_text = metadata.get("checkpoint_free_text_response")
    if isinstance(checkpoint_free_text, dict):
        envelope["kind"] = "checkpoint_free_text_response"
        envelope["checkpoint_free_text_response"] = checkpoint_free_text
    rendered_text = json.dumps(envelope, ensure_ascii=False)
    image_data_url = metadata.get("image_data_url")
    if isinstance(image_data_url, str) and image_data_url.startswith("data:image/"):
        return {
            "role": role,
            "content": [
                {"type": "text", "text": rendered_text},
                {"type": "image_url", "image_url": {"url": image_data_url}},
            ],
        }
    return {"role": role, "content": rendered_text}


async def generate_tutor_turn_stream(
    profile: LlmProfile,
    session: Row,
    history: list[Row],
    *,
    logger: SessionLogger | None = None,
    nonblocking_streak: int = 0,
    force_blocking: bool = False,
) -> AsyncIterator:
    """流式答疑生成器：边从 LLM 收增量边 yield message 可见字符，最后 yield 完整 TutorTurn。

    yield 顺序：
        ("message_delta", "一段可见文本")   多次
        ("turn", TutorTurn)                 最后一次

    可见文本来自 LLM 原始 JSON 中 `"message":"..."` 字段的实时解码字符，
    checkpoint / phase / action 等仍等整段 raw 完整后用 extract_json_object 解析，
    保证结构化字段不被增量解析的边界问题污染。LLM 首次空响应会在本轮内透明重试一次；
    初始题图轮次若首次仍返回 need_problem，也会带原图条件重试一次。连续空响应才抛
    LlmProviderError，由 chat 路由转成 SSE error 事件，而不是静默断流。
    """
    messages = build_messages(
        session,
        history,
        nonblocking_streak=nonblocking_streak,
        force_blocking=force_blocking,
    )
    started = time.perf_counter()
    latency_metrics: dict[str, int | None] = {
        "input_to_first_progress_ms": None,
        "input_to_first_reasoning_event_ms": None,
        "input_to_first_content_ms": None,
        "input_to_first_visible_message_ms": None,
        "input_to_interactive_turn_ms": None,
        "total_completion_ms": None,
    }
    progress_stages: set[str] = set()
    raw = ""
    used_fallback = False
    parse_ok = True
    error: str | None = None
    turn_final: TutorTurn | None = None
    provider_attempts: list[dict[str, Any]] = []

    def elapsed_ms() -> int:
        return int((time.perf_counter() - started) * 1000)

    def progress(stage: str, label: str) -> tuple[str, dict[str, Any]]:
        current_elapsed_ms = elapsed_ms()
        if latency_metrics["input_to_first_progress_ms"] is None:
            latency_metrics["input_to_first_progress_ms"] = current_elapsed_ms
        progress_stages.add(stage)
        return (
            "progress",
            {"stage": stage, "label": label, "elapsed_ms": current_elapsed_ms},
        )

    try:
        yield progress("reading_problem", "正在读取题目")
        request_messages = messages
        format_retry_count = 0
        empty_response_retry_count = 0
        image_need_problem_retry_count = 0
        image_problem_retry_eligible = _is_initial_image_problem_turn(session, history)
        provider_call_count = 0
        while True:
            provider_call_count += 1
            provider_attempt_started = time.perf_counter()
            extractor = MessageStreamExtractor()
            raw_parts: list[str] = []
            emitted_message_parts: list[str] = []
            provider_response_id: str | None = None
            try:
                async for event in chat_stream_completion(
                    profile,
                    request_messages,
                    max_tokens=profile.max_output_tokens,
                ):
                    provider_event = event.get("event")
                    if provider_event == "provider_response":
                        response_id = event.get("response_id")
                        if isinstance(response_id, str) and response_id:
                            provider_response_id = response_id
                        continue
                    if provider_event == "reasoning_delta":
                        if latency_metrics["input_to_first_reasoning_event_ms"] is None:
                            latency_metrics["input_to_first_reasoning_event_ms"] = elapsed_ms()
                        if "checking_thought" not in progress_stages:
                            yield progress("checking_thought", "正在核对你的思路")
                        continue
                    delta = event.get("delta") or ""
                    if delta:
                        if latency_metrics["input_to_first_content_ms"] is None:
                            latency_metrics["input_to_first_content_ms"] = elapsed_ms()
                        if "choosing_action" not in progress_stages:
                            yield progress("choosing_action", "正在选择下一步教学方式")
                        raw_parts.append(delta)
                        inc = extractor.feed(delta)
                        if inc:
                            if latency_metrics["input_to_first_visible_message_ms"] is None:
                                latency_metrics["input_to_first_visible_message_ms"] = elapsed_ms()
                            if "composing_reply" not in progress_stages:
                                yield progress("composing_reply", "正在组织回复")
                            emitted_message_parts.append(inc)
                            yield ("message_delta", inc)
            except LlmEmptyResponseError:
                raw = "".join(raw_parts)
                provider_attempts.append(
                    {
                        "attempt": provider_call_count,
                        "outcome": "empty_response",
                        "latency_ms": int(
                            (time.perf_counter() - provider_attempt_started) * 1000
                        ),
                        "phase": "response_stream",
                        "saw_content": bool(raw),
                        "retryable": True,
                    }
                )
                parse_ok = False
                if emitted_message_parts:
                    yield ("message_reset", "")
                if (
                    empty_response_retry_count < EMPTY_RESPONSE_RETRY_LIMIT
                    and provider_call_count < PROVIDER_ATTEMPT_LIMIT
                ):
                    empty_response_retry_count += 1
                    used_fallback = True
                    yield progress("retrying_empty_response", "模型未返回内容，正在自动重试")
                    continue
                raise
            except LlmProviderError as exc:
                raw = "".join(raw_parts)
                attempt_record = {
                    "attempt": provider_call_count,
                    "outcome": "provider_error",
                    "latency_ms": int(
                        (time.perf_counter() - provider_attempt_started) * 1000
                    ),
                    **exc.diagnostic(),
                }
                provider_attempts.append(attempt_record)
                parse_ok = False
                retry_number = sum(
                    1
                    for attempt in provider_attempts
                    if attempt.get("outcome") == "provider_error"
                )
                delay_seconds = provider_retry_delay_seconds(exc, retry_number)
                within_budget = (
                    time.perf_counter() - started + delay_seconds
                    <= PROVIDER_RETRY_BUDGET_SECONDS
                )
                if (
                    exc.retryable
                    and provider_call_count < PROVIDER_ATTEMPT_LIMIT
                    and within_budget
                ):
                    if emitted_message_parts:
                        yield ("message_reset", "")
                    used_fallback = True
                    attempt_record["retry_delay_ms"] = int(delay_seconds * 1000)
                    next_attempt = provider_call_count + 1
                    wait_seconds = max(1, round(delay_seconds))
                    yield progress(
                        "retrying_provider",
                        f"服务器繁忙，第 {next_attempt} 次重试，预计 {wait_seconds} 秒后继续",
                    )
                    await asyncio.sleep(delay_seconds)
                    continue
                raise
            raw = "".join(raw_parts)
            provider_attempts.append(
                {
                    "attempt": provider_call_count,
                    "outcome": "response_complete",
                    "latency_ms": int(
                        (time.perf_counter() - provider_attempt_started) * 1000
                    ),
                    "phase": "response_stream",
                    "saw_content": bool(raw),
                    "retryable": False,
                }
            )
            try:
                turn_final = parse_and_validate_tutor_turn(
                    raw,
                    force_blocking=force_blocking,
                    current_context_status=_row_value(session, "context_status", "ready"),
                    current_problem_text=_row_value(session, "problem_text", ""),
                    current_student_thought=_row_value(session, "student_initial_thought", ""),
                )
            except (json.JSONDecodeError, ValidationError, ValueError) as exc:
                provider_attempts[-1]["outcome"] = "invalid_tutor_turn"
                provider_attempts[-1]["error"] = str(exc)
                parse_ok = False
                if emitted_message_parts:
                    yield ("message_reset", "")
                if (
                    format_retry_count < FORMAT_RETRY_LIMIT
                    and provider_call_count < PROVIDER_ATTEMPT_LIMIT
                ):
                    format_retry_count += 1
                    used_fallback = True
                    request_messages = build_format_retry_messages(messages, raw, exc)
                    continue
                raise LlmProviderError("模型连续返回不完整或不合法的 JSON，请重试") from exc

            if format_retry_count:
                turn_final.debug["format_retry_count"] = format_retry_count
            if empty_response_retry_count:
                turn_final.debug["empty_response_retry_count"] = empty_response_retry_count
            if (
                image_problem_retry_eligible
                and turn_final.context_status == "need_problem"
                and image_need_problem_retry_count < IMAGE_NEED_PROBLEM_RETRY_LIMIT
                and provider_call_count < PROVIDER_ATTEMPT_LIMIT
            ):
                if emitted_message_parts:
                    yield ("message_reset", "")
                image_need_problem_retry_count += 1
                used_fallback = True
                request_messages = build_image_need_problem_retry_messages(messages)
                yield progress("retrying_problem_image", "正在重新识别题目图片")
                continue
            if image_need_problem_retry_count:
                turn_final.debug["image_need_problem_retry_count"] = (
                    image_need_problem_retry_count
                )
            turn_final.debug["provider_attempts"] = provider_attempts
            parse_ok = True
            emitted_message = "".join(emitted_message_parts)
            if turn_final.message:
                if not emitted_message:
                    if latency_metrics["input_to_first_visible_message_ms"] is None:
                        latency_metrics["input_to_first_visible_message_ms"] = elapsed_ms()
                    if "composing_reply" not in progress_stages:
                        yield progress("composing_reply", "正在组织回复")
                    yield ("message_delta", turn_final.message)
                elif turn_final.message.startswith(emitted_message):
                    missing_suffix = turn_final.message[len(emitted_message) :]
                    if missing_suffix:
                        yield ("message_delta", missing_suffix)
                elif turn_final.message != emitted_message:
                    # Parsing sanitization may normalize control characters or
                    # malformed escape sequences after the raw stream was shown.
                    yield ("message_reset", "")
                    yield ("message_delta", turn_final.message)
            latency_metrics["input_to_interactive_turn_ms"] = elapsed_ms()
            if provider_response_id:
                yield ("provider_response", provider_response_id)
            yield ("turn", turn_final)
            return
    except asyncio.CancelledError:
        error = "generation_cancelled"
        raise
    except Exception as exc:
        error = str(exc)
        # 不吞错误：交给 chat 路由的 try/except 转成 SSE error 事件。
        # 但如果已经在中途 yield 过 message，前端已能看到部分讲解；
        # 这里仍然把异常 raise 出去，保证主流程按"出错"处理。
        raise
    finally:
        latency_ms = int((time.perf_counter() - started) * 1000)
        latency_metrics["total_completion_ms"] = latency_ms
        if logger is not None:
            parsed_dump: dict[str, Any] | None = None
            try:
                parsed_dump = turn_final.model_dump() if turn_final is not None else None
            except Exception:
                parsed_dump = None
            await logger.write_async(
                logger.log_tutor_turn,
                session_id=session["id"],
                model_profile_id=profile.id,
                model=profile.model,
                messages=messages,
                raw_response=raw,
                parsed_turn=parsed_dump,
                latency_ms=latency_ms,
                parse_ok=parse_ok,
                used_fallback=used_fallback,
                error=error,
                latency_metrics=latency_metrics,
                reasoning_effort=profile.reasoning_effort,
                provider_attempts=provider_attempts,
            )
