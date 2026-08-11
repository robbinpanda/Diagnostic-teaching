import asyncio
import json
import threading
from pathlib import Path

from app.storage.session_logger import SessionLogger


def test_async_writer_keeps_event_loop_responsive_and_bounds_queue(tmp_path: Path):
    logger = SessionLogger(tmp_path, async_queue_size=1)
    first_started = threading.Event()
    release_first = threading.Event()
    completed: list[str] = []

    def write(name: str) -> None:
        if name == "first":
            first_started.set()
            release_first.wait(timeout=1)
        completed.append(name)

    async def exercise() -> None:
        first = asyncio.create_task(logger.write_async(write, "first"))
        while not first_started.is_set():
            await asyncio.sleep(0)

        second = asyncio.create_task(logger.write_async(write, "second"))
        while logger.queued_async_writes != 1:
            await asyncio.sleep(0)
        third = asyncio.create_task(logger.write_async(write, "third"))
        await asyncio.sleep(0)

        heartbeat = asyncio.create_task(asyncio.sleep(0.01, result="responsive"))
        assert await asyncio.wait_for(heartbeat, timeout=0.1) == "responsive"
        assert logger.queued_async_writes == 1
        assert not third.done()

        release_first.set()
        await asyncio.gather(first, second, third)
        await logger.close_async_writer()

    asyncio.run(exercise())
    assert completed == ["first", "second", "third"]


def test_async_writer_swallows_write_failures(tmp_path: Path):
    logger = SessionLogger(tmp_path)

    def fail() -> None:
        raise OSError("disk unavailable")

    async def exercise() -> None:
        await logger.write_async(fail)
        await logger.close_async_writer()

    asyncio.run(exercise())


def test_tutor_turn_logs_raw_and_full_checkpoint(tmp_path: Path):
    logger = SessionLogger(tmp_path)
    checkpoint_turn = {
        "state_hint": "checking",
        "action": "ASK_MULTIPLE_CHOICE",
        "wait_for_student": True,
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
        latency_metrics={
            "input_to_first_progress_ms": 0,
            "input_to_first_visible_message_ms": 21,
            "total_completion_ms": 42,
        },
        reasoning_effort="low",
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
    assert ev["latency_metrics"]["input_to_first_visible_message_ms"] == 21
    assert ev["reasoning_effort"] == "low"
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
        next_state_hint="scaffolding",
    )
    events = logger.read("sess_xyz")
    assert len(events) == 1
    ev = events[0]
    assert ev["event"] == "checkpoint_answer"
    assert ev["checkpoint_id"] == "chk_1"
    assert ev["selected_option_id"] == "A"
    assert ev["is_correct"] is True
    assert ev["next_state_hint"] == "scaffolding"
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


def test_problem_image_is_logged_once_then_replaced_with_placeholder(tmp_path: Path):
    logger = SessionLogger(tmp_path)
    image_data_url = "data:image/png;base64," + "a" * 100
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "看图答题"},
                {"type": "image_url", "image_url": {"url": image_data_url}},
            ],
        }
    ]

    for _ in range(2):
        logger.log_tutor_turn(
            session_id="sess_image",
            model_profile_id="prof_1",
            model="vision-model",
            messages=messages,
            raw_response="{}",
            parsed_turn=None,
            latency_ms=1,
            parse_ok=True,
            used_fallback=False,
        )

    events = logger.read("sess_image")
    first_url = events[0]["prompt_messages"][0]["content"][1]["image_url"]["url"]
    second_url = events[1]["prompt_messages"][0]["content"][1]["image_url"]["url"]
    assert first_url == image_data_url
    assert second_url.startswith("[会话图片已在本会话首次")
    assert messages[0]["content"][1]["image_url"]["url"] == image_data_url


def test_logger_writes_spacious_human_readable_companion(tmp_path: Path):
    logger = SessionLogger(tmp_path)
    logger.log_session_started(
        session_id="sess_readable",
        model="demo-model",
        grade_band="junior",
        problem_text="第一行题目\n第二行题目",
        student_initial_thought="先设未知数。",
    )
    logger.log_message(
        session_id="sess_readable",
        message_id="msg_1",
        role="student",
        action_id="act_1",
        action="STUDENT_RESPONSE",
        in_reply_to_action_id="act_0",
        content="我的回答有两步：\n1. 移项\n2. 合并",
    )

    readable = (tmp_path / "sess_readable.log.md").read_text(encoding="utf-8")
    assert "# Session sess_readable" in readable
    assert "## " in readable
    assert "### 题目" in readable
    assert "第一行题目\n    第二行题目" in readable
    assert "Action: `STUDENT_RESPONSE`" in readable
    assert "1. 移项\n    2. 合并" in readable

    jsonl_lines = (tmp_path / "sess_readable.jsonl").read_text(encoding="utf-8").splitlines()
    assert len(jsonl_lines) == 2
    assert all(json.loads(line) for line in jsonl_lines)


def test_logger_delete_removes_both_formats_and_allows_missing_files(tmp_path: Path):
    logger = SessionLogger(tmp_path)
    logger.log_session_started(
        session_id="sess_delete",
        model="demo-model",
        grade_band="junior",
        problem_text="测试删除",
        student_initial_thought="",
    )

    logger.delete("sess_delete")

    assert not (tmp_path / "sess_delete.jsonl").exists()
    assert not (tmp_path / "sess_delete.log.md").exists()
    logger.delete("sess_delete")


def test_logger_delete_all_removes_only_session_log_formats(tmp_path: Path):
    logger = SessionLogger(tmp_path)
    for session_id in ("sess_one", "sess_two"):
        logger.log_session_started(
            session_id=session_id,
            model="demo-model",
            grade_band="junior",
            problem_text="测试批量删除",
            student_initial_thought="",
        )
    keep = tmp_path / "keep.txt"
    keep.write_text("保留", encoding="utf-8")

    logger.delete_all()

    assert list(tmp_path.glob("*.jsonl")) == []
    assert list(tmp_path.glob("*.log.md")) == []
    assert keep.read_text(encoding="utf-8") == "保留"
