from __future__ import annotations

import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class SessionLogger:
    """全盘诊断日志：按 session 追加写 jsonl，每行一个事件。

    设计目标：
    - 不影响主答疑链路：任何写入异常都被吞掉，绝不抛回业务层。
    - 记录对"看卡点"最关键、SQLite 没存的信息：完整 prompt、LLM 原始返回
      （含 markdown/fence）、解析是否走 fallback、检查点正误标签等。
    - 一行一事件，崩溃也只丢最后一行，便于回放。
    """

    def __init__(self, log_dir: Path):
        self.log_dir = Path(log_dir)
        self.log_dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()

    def _append(self, session_id: str, record: dict[str, Any]) -> None:
        record.setdefault("ts", _now_iso())
        record["session_id"] = session_id
        path = self.log_dir / f"{session_id}.jsonl"
        line = json.dumps(record, ensure_ascii=False)
        try:
            with self._lock:
                # "a" 模式原子追加；Windows 下也安全
                with open(path, "a", encoding="utf-8") as f:
                    f.write(line + "\n")
        except OSError:
            # 日志失败绝不影响答疑主流程
            pass

    def log_tutor_turn(
        self,
        *,
        session_id: str,
        model_profile_id: str,
        model: str,
        messages: list[dict[str, str]],
        raw_response: str,
        parsed_turn: dict[str, Any] | None,
        latency_ms: int | None,
        parse_ok: bool,
        used_fallback: bool,
        error: str | None = None,
    ) -> None:
        self._append(
            session_id,
            {
                "event": "tutor_turn",
                "model_profile_id": model_profile_id,
                "model": model,
                "prompt_messages": messages,
                "raw_response": raw_response,
                "parsed_turn": parsed_turn,
                "latency_ms": latency_ms,
                "parse_ok": parse_ok,
                "used_fallback": used_fallback,
                "error": error,
            },
        )

    def log_checkpoint_answer(
        self,
        *,
        session_id: str,
        checkpoint_id: str,
        question: str,
        selected_option_id: str,
        selected_text: str,
        is_correct: bool,
        misconception: str | None,
        elapsed_ms: int,
        event: str,
        next_phase: str,
    ) -> None:
        self._append(
            session_id,
            {
                "event": "checkpoint_answer",
                "checkpoint_id": checkpoint_id,
                "question": question,
                "selected_option_id": selected_option_id,
                "selected_text": selected_text,
                "is_correct": is_correct,
                "misconception": misconception,
                "elapsed_ms": elapsed_ms,
                "checkpoint_event": event,
                "next_phase": next_phase,
            },
        )

    def read(self, session_id: str) -> list[dict[str, Any]]:
        """读回某个 session 的所有事件，便于回放/排查。"""
        path = self.log_dir / f"{session_id}.jsonl"
        events: list[dict[str, Any]] = []
        if not path.exists():
            return events
        try:
            with open(path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line:
                        events.append(json.loads(line))
        except (OSError, json.JSONDecodeError):
            pass
        return events