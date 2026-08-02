from app.core.tutor_turn_policy import (
    BLOCKING_ACTIONS,
    NONBLOCKING_ACTIONS,
    TERMINAL_ACTIONS,
    VALID_ACTIONS,
)


def test_shared_teaching_action_contract_is_exact_and_disjoint() -> None:
    assert BLOCKING_ACTIONS == {"ASK_OPEN_QUESTION", "ASK_MULTIPLE_CHOICE"}
    assert NONBLOCKING_ACTIONS == {
        "EXPLAIN_LOCAL",
        "EXPLAIN_PRINCIPLE",
        "RESPOND_TO_CHECKPOINT",
    }
    assert TERMINAL_ACTIONS == {"SUMMARIZE"}
    assert VALID_ACTIONS == {
        "ASK_OPEN_QUESTION",
        "ASK_MULTIPLE_CHOICE",
        "EXPLAIN_LOCAL",
        "EXPLAIN_PRINCIPLE",
        "RESPOND_TO_CHECKPOINT",
        "SUMMARIZE",
    }
