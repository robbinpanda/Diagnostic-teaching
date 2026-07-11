from __future__ import annotations

import json
import threading
from copy import deepcopy
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
        self._lock = threading.RLock()
        self._sessions_with_logged_images: set[str] = set()

    def _existing_log_contains_image(self, session_id: str) -> bool:
        path = self.log_dir / f"{session_id}.jsonl"
        if not path.exists():
            return False
        try:
            with open(path, "r", encoding="utf-8") as f:
                return any("data:image/" in line for line in f)
        except OSError:
            return False

    def _prepare_prompt_messages(
        self,
        session_id: str,
        messages: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        prepared = deepcopy(messages)
        image_urls: list[dict[str, Any]] = []
        for message in prepared:
            content = message.get("content")
            if not isinstance(content, list):
                continue
            for item in content:
                if not isinstance(item, dict) or item.get("type") != "image_url":
                    continue
                image_url = item.get("image_url")
                if isinstance(image_url, dict) and isinstance(image_url.get("url"), str):
                    image_urls.append(image_url)

        if not image_urls:
            return prepared

        with self._lock:
            image_already_logged = (
                session_id in self._sessions_with_logged_images
                or self._existing_log_contains_image(session_id)
            )
            self._sessions_with_logged_images.add(session_id)

        first_url_to_keep = 0 if not image_already_logged else -1
        for index, image_url in enumerate(image_urls):
            if index != first_url_to_keep:
                image_url["url"] = "[题目原图已在本会话首次 tutor_turn 日志中保存，此处省略]"
        return prepared

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
                "prompt_messages": self._prepare_prompt_messages(session_id, messages),
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
        next_state_hint: str,
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
                "next_state_hint": next_state_hint,
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
