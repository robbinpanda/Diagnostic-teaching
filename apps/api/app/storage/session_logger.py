from __future__ import annotations

import asyncio
import json
import logging
import threading
from collections.abc import Callable
from copy import deepcopy
from dataclasses import dataclass
from datetime import UTC, datetime
from functools import partial
from pathlib import Path
from typing import Any, ParamSpec

LOGGER = logging.getLogger(__name__)
P = ParamSpec("P")
DEFAULT_ASYNC_LOG_QUEUE_SIZE = 32


@dataclass(slots=True)
class _QueuedWrite:
    operation: Callable[[], None]
    completed: asyncio.Future[None]


class AsyncSessionLogWriter:
    """Serialize diagnostic writes through a bounded, off-loop worker."""

    def __init__(self, *, max_queue_size: int = DEFAULT_ASYNC_LOG_QUEUE_SIZE):
        if max_queue_size < 1:
            raise ValueError("max_queue_size must be at least 1")
        self.max_queue_size = max_queue_size
        self._queue: asyncio.Queue[_QueuedWrite | None] | None = None
        self._worker: asyncio.Task[None] | None = None

    def _ensure_worker(self) -> asyncio.Queue[_QueuedWrite | None]:
        loop = asyncio.get_running_loop()
        if (
            self._worker is None
            or self._worker.done()
            or self._worker.get_loop() is not loop
        ):
            self._queue = asyncio.Queue(maxsize=self.max_queue_size)
            self._worker = asyncio.create_task(
                self._run(self._queue),
                name="session-diagnostic-log-writer",
            )
        assert self._queue is not None
        return self._queue

    async def write(
        self,
        operation: Callable[P, None],
        /,
        *args: P.args,
        **kwargs: P.kwargs,
    ) -> None:
        queue = self._ensure_worker()
        completed = asyncio.get_running_loop().create_future()
        await queue.put(_QueuedWrite(partial(operation, *args, **kwargs), completed))
        await asyncio.shield(completed)

    async def _run(self, queue: asyncio.Queue[_QueuedWrite | None]) -> None:
        while True:
            item = await queue.get()
            try:
                if item is None:
                    return
                try:
                    await asyncio.to_thread(item.operation)
                except Exception:
                    LOGGER.warning("Diagnostic session log write failed", exc_info=True)
                finally:
                    if not item.completed.done():
                        item.completed.set_result(None)
            finally:
                queue.task_done()

    async def close(self) -> None:
        worker = self._worker
        queue = self._queue
        if worker is None or queue is None or worker.done():
            self._worker = None
            self._queue = None
            return
        await queue.join()
        await queue.put(None)
        await worker
        if self._worker is worker:
            self._worker = None
            self._queue = None

    @property
    def queued_writes(self) -> int:
        return self._queue.qsize() if self._queue is not None else 0


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


class SessionLogger:
    """全盘诊断日志：严格 JSONL 供机器读取，宽松 Markdown 供人阅读。

    设计目标：
    - 不影响主答疑链路：任何写入异常都被吞掉，绝不抛回业务层。
    - 记录对"看卡点"最关键、SQLite 没存的信息：完整 prompt、LLM 原始返回
      （含 markdown/fence）、解析是否走 fallback、检查点正误标签等。
    - 一行一事件，崩溃也只丢最后一行，便于回放。
    """

    def __init__(
        self,
        log_dir: Path,
        *,
        async_queue_size: int = DEFAULT_ASYNC_LOG_QUEUE_SIZE,
    ):
        self.log_dir = Path(log_dir)
        self.log_dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._sessions_with_logged_images: set[str] = set()
        self._async_writer = AsyncSessionLogWriter(max_queue_size=async_queue_size)

    async def write_async(
        self,
        operation: Callable[P, None],
        /,
        *args: P.args,
        **kwargs: P.kwargs,
    ) -> None:
        """Run one diagnostic write off-loop with bounded FIFO backpressure."""

        await self._async_writer.write(operation, *args, **kwargs)

    async def close_async_writer(self) -> None:
        await self._async_writer.close()

    @property
    def queued_async_writes(self) -> int:
        return self._async_writer.queued_writes

    def _existing_log_contains_image(self, session_id: str) -> bool:
        path = self.log_dir / f"{session_id}.jsonl"
        if not path.exists():
            return False
        try:
            with open(path, encoding="utf-8") as f:
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
                image_url["url"] = "[会话图片已在本会话首次含图 tutor_turn 日志中保存，此处省略]"
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
                self._append_readable(session_id, record)
        except OSError:
            # 日志失败绝不影响答疑主流程
            pass

    def _append_readable(self, session_id: str, record: dict[str, Any]) -> None:
        """Write a spacious Markdown companion; JSONL stays strict and machine-readable."""
        path = self.log_dir / f"{session_id}.log.md"
        event = record.get("event", "event")
        ts = record.get("ts", "")
        sections = [f"## {ts} · {event}", ""]

        if event == "session_started":
            sections.extend(
                [
                    f"- Session: `{session_id}`",
                    f"- Model: `{record.get('model', '')}`",
                    f"- Grade: `{record.get('grade_band', '')}`",
                    f"- Restored from: `{record.get('restored_from') or '-'}`",
                    "",
                    "### 题目",
                    "",
                    self._indent(record.get("problem_text", "")),
                    "",
                    "### 学生初始思路",
                    "",
                    self._indent(record.get("student_initial_thought") or "（未提供）"),
                ]
            )
        elif event == "message":
            sections.extend(
                [
                    f"- Role: `{record.get('role', '')}`",
                    f"- Action: `{record.get('action', '')}`",
                    f"- Action ID: `{record.get('action_id', '')}`",
                    f"- Reply to: `{record.get('in_reply_to_action_id') or '-'}`",
                    "",
                    "### 内容",
                    "",
                    self._indent(record.get("content", "")),
                ]
            )
        elif event == "tutor_turn":
            sections.extend(["### 发给模型的结构化消息", ""])
            for index, message in enumerate(record.get("prompt_messages") or [], start=1):
                sections.extend(
                    [
                        f"#### {index}. {str(message.get('role', '')).upper()}",
                        "",
                        self._indent(self._readable_content(message.get("content"))),
                        "",
                    ]
                )
            sections.extend(
                [
                    "### 模型原始返回",
                    "",
                    self._indent(record.get("raw_response") or "（空）"),
                    "",
                    "### 解析后的教学 action",
                    "",
                    self._indent(json.dumps(record.get("parsed_turn"), ensure_ascii=False, indent=2)),
                    "",
                    f"- Latency: `{record.get('latency_ms')} ms`",
                    f"- Reasoning effort: `{record.get('reasoning_effort') or 'low'}`",
                    f"- Latency metrics: `{json.dumps(record.get('latency_metrics') or {}, ensure_ascii=False)}`",
                    f"- Parse OK: `{record.get('parse_ok')}`",
                    f"- Retried: `{record.get('used_fallback')}`",
                    f"- Provider attempts: `{json.dumps(record.get('provider_attempts') or [], ensure_ascii=False)}`",
                    f"- Error: `{record.get('error') or '-'}`",
                ]
            )
        elif event == "checkpoint_answer":
            sections.extend(
                [
                    f"- Checkpoint: `{record.get('checkpoint_id', '')}`",
                    f"- Result: `{record.get('checkpoint_event', '')}`",
                    f"- Correct: `{record.get('is_correct')}`",
                    f"- Elapsed: `{record.get('elapsed_ms')} ms`",
                    "",
                    "### 检查点",
                    "",
                    self._indent(record.get("question", "")),
                    "",
                    "### 学生回答",
                    "",
                    self._indent(
                        f"{record.get('selected_option_id', '')} {record.get('selected_text', '')}"
                    ),
                    "",
                    "### 对应误区",
                    "",
                    self._indent(record.get("misconception") or "（无）"),
                    "",
                    f"下一状态：`{record.get('next_state_hint', '')}`",
                ]
            )
        else:
            sections.append(self._indent(json.dumps(record, ensure_ascii=False, indent=2)))

        with open(path, "a", encoding="utf-8") as f:
            if path.stat().st_size == 0:
                f.write(f"# Session {session_id}\n\n")
            f.write("\n".join(sections).rstrip() + "\n\n---\n\n")

    @staticmethod
    def _indent(value: Any) -> str:
        text = str(value).replace("\r\n", "\n")
        return "\n".join(f"    {line}" for line in text.split("\n"))

    @staticmethod
    def _readable_content(content: Any) -> str:
        if isinstance(content, str):
            return content
        prepared = deepcopy(content)
        if isinstance(prepared, list):
            for item in prepared:
                if not isinstance(item, dict) or item.get("type") != "image_url":
                    continue
                image = item.get("image_url")
                if isinstance(image, dict) and str(image.get("url", "")).startswith("data:image/"):
                    image["url"] = "[会话图片 base64 已省略；图片保存在 SQLite 会话记录中]"
        return json.dumps(prepared, ensure_ascii=False, indent=2)

    def log_session_started(
        self,
        *,
        session_id: str,
        model: str,
        grade_band: str,
        problem_text: str,
        student_initial_thought: str,
        restored_from: str | None = None,
    ) -> None:
        self._append(
            session_id,
            {
                "event": "session_started",
                "model": model,
                "grade_band": grade_band,
                "problem_text": problem_text,
                "student_initial_thought": student_initial_thought,
                "restored_from": restored_from,
            },
        )

    def log_message(
        self,
        *,
        session_id: str,
        message_id: str,
        role: str,
        action_id: str | None,
        action: str,
        in_reply_to_action_id: str | None,
        content: str,
    ) -> None:
        self._append(
            session_id,
            {
                "event": "message",
                "message_id": message_id,
                "role": role,
                "action_id": action_id,
                "action": action,
                "in_reply_to_action_id": in_reply_to_action_id,
                "content": content,
            },
        )

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
        latency_metrics: dict[str, int | None] | None = None,
        reasoning_effort: str = "low",
        provider_attempts: list[dict[str, Any]] | None = None,
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
                "latency_metrics": latency_metrics or {},
                "reasoning_effort": reasoning_effort,
                "parse_ok": parse_ok,
                "used_fallback": used_fallback,
                "provider_attempts": provider_attempts or [],
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
            with open(path, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line:
                        events.append(json.loads(line))
        except (OSError, json.JSONDecodeError):
            pass
        return events

    def delete(self, session_id: str) -> None:
        """Delete both session log formats; already-missing files are successful."""
        with self._lock:
            (self.log_dir / f"{session_id}.jsonl").unlink(missing_ok=True)
            (self.log_dir / f"{session_id}.log.md").unlink(missing_ok=True)
            self._sessions_with_logged_images.discard(session_id)

    def delete_all(self) -> None:
        """Delete every JSONL and Markdown session log in the configured log directory."""
        with self._lock:
            for pattern in ("*.jsonl", "*.log.md"):
                for path in self.log_dir.glob(pattern):
                    path.unlink(missing_ok=True)
            self._sessions_with_logged_images.clear()
