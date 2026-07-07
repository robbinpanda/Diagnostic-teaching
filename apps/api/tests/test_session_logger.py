import json
from pathlib import Path

from app.storage.session_logger import SessionLogger


def test_tutor_turn_logs_raw_and_full_checkpoint(tmp_path: Path):
    logger = SessionLogger(tmp_path)
    checkpoint_turn = {
        "phase": "checking",
        "action": "SHOW_CHECKPOINT_MC",
        "message": "抓一个点",
        "checkpoint": {
            "type": "checkpoint_mc",
            "question": "平方项应该尽量怎样？",
            "options": [
                {"id": "A", "text": "尽量小", "is_correct": True, "misconception": None},
                {"id": "B", "text": "尽量大", "is_correct": False, "misconception": "忽略负号"},
            ],
            "unknown_option": {"id": "UNKNOWN", "text": "我不知道"},
            "tested_point": "平方项非负",
            "difficulty": "easy",
        },
    }
    logger.log_tutor_turn(
        session_id="sess_abc",
        model_profile_id="prof_1",
        model="local-demo",
        messages=[{"role": "system", "content": "S"}, {"role": "user", "content": "U"}],
        raw_response="```json\n{\"phase\":\"checking\"}\n```",
        parsed_turn=checkpoint_turn,
        latency_ms=42,
        parse_ok=True,
        used_fallback=False,
    )

    events = logger.read("sess_abc")
    assert len(events) == 1
    ev = events[0]
    assert ev["event"] == "tutor_turn"
    # raw 原文（含 markdown fence）必须留存
    assert "```json" in ev["raw_response"]
    # prompt 全量
    assert ev["prompt_messages"][1]["content"] == "U"
    # checkpoint 正误标签未被裁剪
    opts = ev["parsed_turn"]["checkpoint"]["options"]
    assert opts[0]["is_correct"] is True
    assert opts[1]["misconception"] == "忽略负号"
    assert ev["latency_ms"] == 42
    assert ev["parse_ok"] is True


def test_checkpoint_answer_event_recorded(tmp_path: Path):
    logger = SessionLogger(tmp_path)
    logger.log_checkpoint_answer(
        session_id="sess_xyz",
        checkpoint_id="chk_1",
        question="平方项应该尽量怎样？",
        selected_option_id="A",
        selected_text="尽量小",
        is_correct=True,
        misconception=None,
        elapsed_ms=800,
        event="CHECKPOINT_CORRECT",
        next_phase="scaffolding",
    )
    events = logger.read("sess_xyz")
    assert len(events) == 1
    ev = events[0]
    assert ev["event"] == "checkpoint_answer"
    assert ev["checkpoint_id"] == "chk_1"
    assert ev["selected_option_id"] == "A"
    assert ev["is_correct"] is True
    assert ev["next_phase"] == "scaffolding"
    assert ev["checkpoint_event"] == "CHECKPOINT_CORRECT"


def test_multiple_events_append_as_jsonl_lines(tmp_path: Path):
    logger = SessionLogger(tmp_path)
    for i in range(3):
        logger.log_tutor_turn(
            session_id="sess_multi",
            model_profile_id="prof_1",
            model="m",
            messages=[{"role": "user", "content": str(i)}],
            raw_response=f"raw{i}",
            parsed_turn=None,
            latency_ms=i,
            parse_ok=False,
            used_fallback=True,
        )
    events = logger.read("sess_multi")
    assert len(events) == 3
    assert [ev["latency_ms"] for ev in events] == [0, 1, 2]
    # 文件确实是逐行 jsonl
    path = tmp_path / "sess_multi.jsonl"
    lines = path.read_text(encoding="utf-8").strip().split("\n")
    assert len(lines) == 3
    for line in lines:
        json.loads(line)  # 每行可独立解析


def test_logger_failure_does_not_raise(tmp_path: Path):
    """日志写盘失败绝不影响答疑主流程"""
    logger = SessionLogger(tmp_path / "nope")  # dir 已被建好相关逻辑会处理
    # 强制指向不可写路径
    logger.log_dir = tmp_path / "guarded" / "deep"  # 父目录不存在且不让建
    # 不应抛异常
    logger.log_tutor_turn(
        session_id="sess_x",
        model_profile_id="p",
        model="m",
        messages=[],
        raw_response="r",
        parsed_turn=None,
        latency_ms=1,
        parse_ok=True,
        used_fallback=False,
    )