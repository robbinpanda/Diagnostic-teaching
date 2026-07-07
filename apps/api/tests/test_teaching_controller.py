import pytest

from app.core.schemas import TutorCheckpoint, TutorCheckpointOption
from app.core.teaching_controller import recover_tutor_turn_from_raw, validate_checkpoint


def test_checkpoint_requires_exactly_one_correct_option():
    checkpoint = TutorCheckpoint(
        question="平方项最小是多少？",
        tested_point="平方项非负",
        options=[
            TutorCheckpointOption(id="A", text="0", is_correct=True),
            TutorCheckpointOption(id="B", text="1", is_correct=True),
            TutorCheckpointOption(id="C", text="-1", is_correct=False, misconception="以为平方可为负"),
        ],
    )

    with pytest.raises(ValueError):
        validate_checkpoint(checkpoint)


def test_checkpoint_rejects_meta_question():
    checkpoint = TutorCheckpoint(
        question="你听懂了吗？",
        tested_point="元认知问题不合格",
        options=[
            TutorCheckpointOption(id="A", text="懂了", is_correct=True),
            TutorCheckpointOption(id="B", text="没懂", is_correct=False, misconception="不是数学误区"),
            TutorCheckpointOption(id="C", text="不知道", is_correct=False, misconception="不是数学误区"),
        ],
    )

    with pytest.raises(ValueError):
        validate_checkpoint(checkpoint)


def test_recover_message_from_truncated_markdown_json():
    raw = """```json
{
  "phase": "scaffolding",
  "action": "SHOW_CHECKPOINT_MC",
  "message": "还没结束！你已经知道 $a_3^2 = a_1 \\cdot a_5$，现在需要求出 $a_1 \\cdot a_5$ 的值。题目说两个数是方程的两个根，下一步用韦达定理。",
  "checkpoint": {
    "question": "若 $a_1$、$a"""

    turn = recover_tutor_turn_from_raw(raw)

    assert turn.phase == "scaffolding"
    assert turn.action == "EXPLAIN_LOCAL"
    assert "还没结束" in turn.message
    assert "韦达定理" in turn.message
    assert turn.checkpoint is None
