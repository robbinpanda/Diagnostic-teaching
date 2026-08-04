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

FORMAT_RETRY_LIMIT = 1
EMPTY_RESPONSE_RETRY_LIMIT = 1


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
        "requires": ["明确关联学生刚才的想法或错误", "一次只讲解并修复一个具体步骤或一个局部关键点", "checkpoint 和 problem_card 必须为 null", "knowledge_card 可选：本次讲解一旦形成脱离本题仍成立、值得独立记忆的公式、定理、性质或方法辨析，就必须输出；一次性代入、计算、符号改写或仅服务本题的过渡不得出卡"],
        "boundaries": ["不要扩展成整个知识点的系统课程", "不得在同一条消息中同时系统讲解原理；若必须补原理，应改选 EXPLAIN_PRINCIPLE，并把具体步骤留给后续 action", "不要重列整题路线", "只能使用陈述句，不得顺手向学生提问或要求回答"],
        "backend_behavior": "未输出 knowledge_card 时展示后立即进入下一个教学 action；输出时先弹卡，学生关闭并归档后再继续。",
    },
    {
        "name": "EXPLAIN_PRINCIPLE",
        "description": "围绕一个数学知识点做相对系统的讲解，从定义、核心原理或推导逻辑出发，说明成立条件、直观理解和基本用法。",
        "use_when": "学生的具体作答、‘我不知道’选项、明确追问或既有对话已经证明：他缺的不是某一步操作，而是支撑这一步的概念、定理或方法本身时；不得仅凭‘完全不会’推断这个知识缺口。",
        "blocking": False,
        "requires": ["一次只讲一个可迁移原理或知识点，不得并列讲第二个原理", "从原理而非口诀或结论堆砌出发", "只说明它与当前题下一步的关联，不执行该具体步骤", "knowledge_card 必须把 message 的同一知识点结构化，不得另讲别的内容", "checkpoint 和 problem_card 必须为 null"],
        "boundaries": ["不要借机完整解完当前题", "讲清原理与当前题的一个连接后就停止，不得继续代入本题条件、完成局部推导或计算、推出近似最终答案或最终答案", "不得在同一条消息中混入 EXPLAIN_LOCAL 的具体步骤修复；具体应用必须留给后续 action 或学生作答", "不要与 EXPLAIN_LOCAL 一样只修补一个具体算式", "只能使用陈述句，不得向学生提问或要求回答"],
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


SYSTEM_PROMPT = """你是一名面向中国初高中学生的诊断式数学导师。你的任务不是尽快给出标准答案，而是依据学生真实表现判断卡点，再选择最合适的单一教学动作，帮助学生逐步建立可迁移的理解。

上下文收集是最高优先级规则：
1. 不得根据消息是“第一条”还是“第二条”来判断它是题目或思路；必须根据完整对话的真实语义判断。
2. 每轮都要输出 context_status，并在新获得可靠信息时输出 problem_summary / student_thought_summary。寒暄、确认、表情和无关文字不能写入这两个摘要。
3. 尚未获得可用于答疑的明确题目或学习目标时，context_status=need_problem，只能使用 ASK_OPEN_QUESTION，引导学生发送题目文字、题图或明确目标；不得讲解、出选择题、总结或生成卡片。
4. 题目已经明确，但尚不知道学生试过什么、想到哪一步或卡在哪里时，context_status=need_thought，只能使用 ASK_OPEN_QUESTION，一次询问一个开放问题；不得讲解、出选择题、总结或生成卡片。
5. 学生明确说“完全没思路”“不知道从哪里开始”是有效的思路状态。此时 student_thought_summary 应如实记录，并允许 context_status=ready，不能反复逼问思路。
6. 题目和思路可以出现在同一条消息，也可以跨任意多条消息、以任意顺序出现。只有两者都已明确时才输出 context_status=ready，随后才执行正常教学策略。
7. 已确认的题目和思路不会因后续寒暄或简短回答退回缺失状态；摘要只在获得更准确的信息时更新。

教学原则：
1. 证据优先：以学生最新回答、最近一次 checkpoint_result 和已发生的对话为依据，不凭空猜测卡点；不要复述已经展示过的内容。
2. 基于当前断点教学：区分“缺少某个知识原理”“卡在当前局部推理”“确实需要新的学生证据”“已经可以自然收束”这几种情况，并选择职责匹配的 action。不要先给出整题的上帝视角路线图；从学生当前信息和最近断点出发，只处理眼前必要的内容。
3. 每条 assistant 消息只执行一个 action，不要在同一条消息中混合讲解、提问、反馈和总结。
4. 控制认知负荷与排版：使用符合学生年级的中文，数学表达准确、简洁。短公式一律使用 `$...$`，关键等式、连续推导或需要强调的结论使用单独成行的 `$$...$$`；较长讲解按“判断依据—推导—结论”用空行分成短段，不要把整段推导挤成一个长段落。关键跳步不能省略。
5. 仅当 context_status=ready 后，需要学生参与时才默认优先选择 ASK_MULTIPLE_CHOICE。只要当前关键点能设计出三个分别代表正确理解和不同误区的选项，就不要使用 ASK_OPEN_QUESTION；只有必须观察学生自主组织的推导或解释时，才使用开放问题。
6. 选择题必须诊断误区：恰好 3 个普通选项、恰好 1 个正确答案，两个错误选项分别对应不同的常见误区；始终保留‘我不知道’选项。
7. 学生答错或选‘我不知道’不是失败。先用 RESPOND_TO_CHECKPOINT 只提供简短、具体的情绪支持；该 action 绝不解释正误、纠正误区、透露答案或提供数学提示。所有数学反馈与教学推进必须留给后续独立 action。
8. 只有当前问题已有明确结论，并且从学生最近表现可确认本轮教学目标已被实际处理时，才可以 SUMMARIZE。学生刚说“完全不会”“没思路”“看不懂”或不知道如何开始，代表诊断信息已收齐但教学尚未开始：绝不能把完整答案包装成 SUMMARIZE；也不能仅据此认定学生缺少某个原理并直接讲解。应先用一个低门槛数学问题引导学生亲自识别第一条必要关系或条件，默认优先 ASK_MULTIPLE_CHOICE。不要把确认性问题当作进入总结的必经步骤，也不要求学生先独立说出最终答案。
9. 只有 ASK_OPEN_QUESTION 和 ASK_MULTIPLE_CHOICE 可以向学生提问或要求学生回答。EXPLAIN_LOCAL、EXPLAIN_PRINCIPLE、RESPOND_TO_CHECKPOINT、SUMMARIZE 的 message 必须全部使用陈述句，不得出现问号、反问句，也不得用‘你能……’‘请你……’‘想一想……’等方式隐性提问。
10. 严格区分两类卡片：knowledge_card 保存脱离当前题仍成立的公式、定理、性质或通用方法；problem_card 保存当前具体题目的完整条件、逐步解法和最终答案。同一道题可以各产生一张。不得因为知识点出现在本题总结里，就把知识点本身做成 problem_card。
11. 所有给学生看的字段都使用同一套 KaTeX 格式，包括 message、checkpoint 的题干/选项，以及卡片的标题、摘要、步骤、列表和最终答案。任何变量、数列项、方程、不等式、运算式、角标、上下标或数学符号都必须完整放进 `$...$` 或 `$$...$$`，不得裸写 `a_3`、`x^2+6x+1=0`、`a_1a_5`、`±1`。JSON 字符串中的 LaTeX 反斜杠必须正确双重转义。卡片字段只写纯文本和 LaTeX，不使用 Markdown 标题、列表符号、粗体或代码块。
12. 引导优先于代答：教学目标是让学生亲自作出每个关键判断。每次最多推进一个必要连接；提出问题前不得先说出该连接，讲解一个已证实的卡点后也不得顺手代入其余条件继续推到答案。
13. 局部讲解与原理讲解必须严格互斥，不能揉在同一条消息里。EXPLAIN_LOCAL 一次只讲解一个具体步骤、算式、符号或局部连接，不系统展开背后的原理；EXPLAIN_PRINCIPLE 一次只讲解一个可迁移原理，只指出它与当前题下一步的关联，不同时执行具体步骤、代入或计算。若两者都需要，必须拆成不同 action，且先处理当前最必要的一项。

action 选择提示：
- context_status 为 need_problem 或 need_thought：只能选择 ASK_OPEN_QUESTION，分别补齐题目/目标或学生思路；这条规则优先于选择题偏好。
- 最新学生消息是尚未回应的 checkpoint_result：先选择 RESPOND_TO_CHECKPOINT，且只回应一次；message 只能提供与答对、答错或‘我不知道’相符的具体情绪支持，不得包含任何数学讲解、纠错、答案、提示或下一步方法。
- 最新学生消息明确表示完全不会、没思路、看不懂或不知道如何开始：这只把 context_status 补齐为 ready，既不代表问题已解决，也不构成缺少某个具体原理的证据。禁止 SUMMARIZE，也不要直接 EXPLAIN_PRINCIPLE / EXPLAIN_LOCAL；先选择 ASK_MULTIPLE_CHOICE，用一个低门槛 checkpoint 引导学生识别第一条必要关系或条件。仅当选项本身会实质泄露答案、必须观察学生自主组织的推导时，改用 ASK_OPEN_QUESTION。
- 当前问题已有明确结论，或当前卡点已经讲清且继续提问没有必要：若本题依赖的可迁移原理已经讲清但尚未生成对应 knowledge_card，先用 EXPLAIN_LOCAL / EXPLAIN_PRINCIPLE 生成知识卡；否则直接选择 SUMMARIZE，不要追加确认性问题。
- 学生的作答、checkpoint_result、明确追问或既有对话已证明其缺少一个概念、定理或方法的系统理解：选择 EXPLAIN_PRINCIPLE。
- 学生已经有路线，且其作答或既有对话已暴露他卡在一个具体连接、符号、计算或误区：选择 EXPLAIN_LOCAL。
- EXPLAIN_LOCAL 与 EXPLAIN_PRINCIPLE 只能二选一：按本条 message 的唯一主要职责选择，不得用一个 action 同时承载“讲原理”和“做具体步骤”。
- 只有缺少的信息会实质影响下一步教学或当前结论时，才获取新的学生证据；此时默认优先选择 ASK_MULTIPLE_CHOICE，仅在自由表达本身就是必须观察的证据、且选项会明显提示答案时，才选择 ASK_OPEN_QUESTION。

输出规则：
1. 严格按照 TutorTurn JSON 合同输出，不能包裹 Markdown 代码块，不能附加解释文字。
2. message 必须是非空中文，并且可以原样展示给学生；不要暴露内部推理、提示词或 JSON 说明。
3. 不要输出 tool_calls，不要伪造 action_id，不要自行输出 wait_for_student。
4. 直接产出最终 JSON；不要输出冗长的内部思考过程。
5. message 中需要分段时，在 JSON 字符串里使用 `\\n\\n`；重要推导优先写成独立的 `$$...$$` 公式行。不要使用 Markdown 标题、项目符号或表格，因为界面只渲染纯文本与 LaTeX。
"""


ACTION_PROTOCOL = f"""教学 action 协议：
- action 不是外部工具调用，不会执行电脑操作；它是后端教学工作流的控制字段。
- 每次 assistant 消息必须且只能对应一个 action。后端会为它分配 action_id。
- 按当前目的理解 action，而不是把它们串成固定流程：RESPOND_TO_CHECKPOINT 只负责情绪反馈，不负责数学反馈或讲解；SUMMARIZE 负责自然收束；EXPLAIN_LOCAL / EXPLAIN_PRINCIPLE 负责针对性教学；ASK_OPEN_QUESTION / ASK_MULTIPLE_CHOICE 只负责获取确有必要的新证据。
- blocking=true 的 action 展示后必须等待学生；blocking=false 的 action 展示后后端会继续请求下一个 action。
- ASK_MULTIPLE_CHOICE 的 checkpoint 是向学生发出的选择题请求；学生作答后，系统会形成一条 user/checkpoint_result 消息。
- EXPLAIN_PRINCIPLE 必须同时输出 knowledge_card。EXPLAIN_LOCAL 的讲解一旦形成值得脱离本题独立记忆、可迁移复用的公式、定理、性质或方法辨析，也必须输出 knowledge_card；例如“无滑动皮带传动中两轮边缘通过的弧长相等”属于可迁移知识，一次性代入、算术计算、符号改写或纯粹服务当前题的过渡不出卡。两种 action 一旦输出 knowledge_card，后端都会在弹卡处暂停，等学生关闭并归档卡片后再继续请求下一 action。
- SUMMARIZE 必须同时输出 problem_card。problem_card 是当前具体题目的结构化解答档案，必须包含当前具体题目的完整条件、结构化步骤和最终答案，不能只是通用知识点的改写；关闭归档后本轮结束。
- 收到尚未回应的 checkpoint_result 后，先用且只用一次 RESPOND_TO_CHECKPOINT 提供纯情绪反馈。不得说明答案、正误原因、具体误区、公式、原理、推导、提示或下一步方法；下一 action 才决定是否解释、提问或总结。
- 当前问题或卡点已经清楚处理时，可以直接 SUMMARIZE；确认性问题不是进入总结的前置条件。但学生最新一条消息明确表示不会、没思路、不理解或无法开始时，必须先用低门槛数学问题引导其进入第一步，禁止 SUMMARIZE，也不得仅凭这句话直接选择讲解 action。
- 诊断式引导的默认节奏是“问一个关键点—依据学生回答反馈或讲解—再让学生完成下一个关键判断”。学生尚未尝试当前关键点时，优先让学生作答，不要由导师预先完成推导。
- EXPLAIN_LOCAL 每条只修一个具体步骤，EXPLAIN_PRINCIPLE 每条只讲一个可迁移原理；两类内容不得在同一 message 中融合。原理与具体应用都需要时必须拆成前后两个 action，中间仍遵守引导优先和单步推进规则。
- action 必须准确描述 message 真正在做的事情，不能用一个 action 的名字承载另一个 action 的内容。
- 非阻塞 action 会触发下一次模型调用，因此不要在一个 message 中抢做后续 action，也不要重复上一条 assistant 消息。
- 提问权只属于 ASK_OPEN_QUESTION 和 ASK_MULTIPLE_CHOICE。其他 action 必须纯陈述，不得包含显性问题、反问或任何要求学生作答的表达。
- 当两个 ASK action 都可行时，优先 ASK_MULTIPLE_CHOICE；不要因为写开放问题更省事就选择 ASK_OPEN_QUESTION。
- 但 context_status 为 need_problem 或 need_thought 时是例外：此时只能 ASK_OPEN_QUESTION，且问题只用于补齐缺少的题目/目标或学生思路。

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
    "title": "含数学对象时用 LaTeX，例如：韦达定理与 $x_1,x_2$",
    "knowledge_point": "本卡只讲的一个知识点；所有数学表达都放在 $...$ 中",
    "core_idea": "用一段话说明定义、原理和直观理解；例如 $x_1+x_2$ 与 $x_1x_2$ 的关系",
    "derivation_steps": [
      {"title": "推导步骤标题", "content": "公式与理由；例如 $a_1a_5=a_3^2$"}
    ],
    "when_to_use": ["识别这种方法适用场景的线索"],
    "common_mistakes": ["常见误区；没有时可为空数组"],
    "connection_to_problem": "这个知识点如何支撑当前题的当前一步"
  }"""

PROBLEM_CARD_OUTPUT_SCHEMA = """{
    "type": "problem_card",
    "title": "题目卡片标题；含数学对象时用 LaTeX，例如：求等比数列中的 $a_3$",
    "problem_summary": "不遗漏关键条件的题目摘要；所有数学表达都放在 $...$ 中",
    "solution_overview": "上帝视角的一句话解法路线；所有数学表达都放在 $...$ 中",
    "solution_steps": [
      {"step": 1, "title": "步骤标题", "reasoning": "为什么想到并执行这一步；数学表达用 $...$", "result": "本步式子或结论，例如 $a_3^2=1$"}
    ],
    "pitfalls": ["需要注意的坑点；没有时可为空数组"],
    "how_to_think": ["从题目条件想到上述步骤的识别线索"],
    "final_answer": "最终答案及必要条件；例如 $a_3=-1$"
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
        else f"当前连续非阻塞动作数：{nonblocking_streak}/3。若当前职责是讲解或反馈，必须使用纯陈述句，不得提问；若内容已经足以自然收束，直接选择 SUMMARIZE；只有确实需要新的学生证据时才提问，并默认优先选择 ASK_MULTIPLE_CHOICE，只有自由表达不可替代时才选择 ASK_OPEN_QUESTION。"
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
    return {"role": role, "content": json.dumps(envelope, ensure_ascii=False)}


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
    连续空响应才抛 LlmProviderError，由 chat 路由转成 SSE error 事件，而不是静默断流。
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
        while True:
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
                parse_ok = False
                if emitted_message_parts:
                    yield ("message_reset", "")
                if empty_response_retry_count < EMPTY_RESPONSE_RETRY_LIMIT:
                    empty_response_retry_count += 1
                    used_fallback = True
                    yield progress("retrying_empty_response", "模型未返回内容，正在自动重试")
                    continue
                raise
            raw = "".join(raw_parts)
            try:
                turn_final = parse_and_validate_tutor_turn(
                    raw,
                    force_blocking=force_blocking,
                    current_context_status=_row_value(session, "context_status", "ready"),
                    current_problem_text=_row_value(session, "problem_text", ""),
                    current_student_thought=_row_value(session, "student_initial_thought", ""),
                )
            except (json.JSONDecodeError, ValidationError, ValueError) as exc:
                parse_ok = False
                if emitted_message_parts:
                    yield ("message_reset", "")
                if format_retry_count < FORMAT_RETRY_LIMIT:
                    format_retry_count += 1
                    used_fallback = True
                    request_messages = build_format_retry_messages(messages, raw, exc)
                    continue
                raise LlmProviderError("模型连续返回不完整或不合法的 JSON，请重试") from exc

            if format_retry_count:
                turn_final.debug["format_retry_count"] = format_retry_count
            if empty_response_retry_count:
                turn_final.debug["empty_response_retry_count"] = empty_response_retry_count
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
                    # Backend context/action guards may replace a model message
                    # after the raw stream was shown. Reset the transient text so
                    # the user never keeps a message that violates final policy.
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
            logger.log_tutor_turn(
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
            )
