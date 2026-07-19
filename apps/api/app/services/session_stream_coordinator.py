from __future__ import annotations

import asyncio
from contextlib import suppress
from dataclasses import dataclass, field
from typing import Any, AsyncIterator


class RunInterrupted(RuntimeError):
    pass


@dataclass(eq=False)
class SessionRunHandle:
    run_id: str
    session_id: str
    session_lock: asyncio.Lock
    cancel_event: asyncio.Event = field(default_factory=asyncio.Event)
    state: str = "queued"
    interrupt_requested: bool = False
    holds_lock: bool = False
    execution_task: asyncio.Task | None = None


class SessionStreamCoordinator:
    """Serialize one session while allowing unrelated sessions to run in parallel."""

    def __init__(self) -> None:
        self._guard = asyncio.Lock()
        self._session_locks: dict[str, asyncio.Lock] = {}
        self._handles: dict[str, list[SessionRunHandle]] = {}
        self._running: dict[str, SessionRunHandle] = {}

    async def enqueue(self, session_id: str, run_id: str) -> SessionRunHandle:
        async with self._guard:
            session_lock = self._session_locks.setdefault(session_id, asyncio.Lock())
            handle = SessionRunHandle(run_id=run_id, session_id=session_id, session_lock=session_lock)
            self._handles.setdefault(session_id, []).append(handle)
            return handle

    async def start(self, handle: SessionRunHandle) -> None:
        acquire_task = asyncio.create_task(handle.session_lock.acquire())
        interrupt_task = asyncio.create_task(handle.cancel_event.wait())
        try:
            await asyncio.wait(
                {acquire_task, interrupt_task},
                return_when=asyncio.FIRST_COMPLETED,
            )
            if handle.cancel_event.is_set():
                if (
                    acquire_task.done()
                    and not acquire_task.cancelled()
                    and acquire_task.exception() is None
                ):
                    handle.holds_lock = bool(acquire_task.result())
                else:
                    acquire_task.cancel()
                    with suppress(asyncio.CancelledError):
                        await acquire_task
                raise RunInterrupted(handle.run_id)

            await acquire_task
            handle.holds_lock = True
            async with self._guard:
                if handle.interrupt_requested:
                    raise RunInterrupted(handle.run_id)
                handle.state = "running"
                self._running[handle.session_id] = handle
        finally:
            if not acquire_task.done():
                acquire_task.cancel()
                with suppress(asyncio.CancelledError):
                    await acquire_task
            interrupt_task.cancel()
            with suppress(asyncio.CancelledError):
                await interrupt_task

    async def set_execution_task(
        self,
        handle: SessionRunHandle,
        task: asyncio.Task | None,
    ) -> None:
        async with self._guard:
            handle.execution_task = task

    async def request_interrupt(self, session_id: str) -> list[SessionRunHandle]:
        """Flag queued/running work; callers persist status before cancelling tasks."""
        async with self._guard:
            targets = [
                handle
                for handle in self._handles.get(session_id, [])
                if handle.state in {"queued", "running"}
            ]
            for handle in targets:
                handle.interrupt_requested = True
                handle.state = "interrupted"
                handle.cancel_event.set()
                if self._running.get(session_id) is handle:
                    self._running.pop(session_id, None)
            return targets

    @staticmethod
    def cancel_execution_tasks(handles: list[SessionRunHandle]) -> None:
        for handle in handles:
            task = handle.execution_task
            if task is not None and not task.done():
                task.cancel()

    async def mark_completed(self, handle: SessionRunHandle) -> None:
        async with self._guard:
            handle.state = "completed"
            if self._running.get(handle.session_id) is handle:
                self._running.pop(handle.session_id, None)

    async def finish(self, handle: SessionRunHandle) -> None:
        task = handle.execution_task
        if task is not None and not task.done():
            task.cancel()
            with suppress(asyncio.CancelledError, Exception):
                await task
        async with self._guard:
            handle.execution_task = None
            handles = self._handles.get(handle.session_id, [])
            if handle in handles:
                handles.remove(handle)
            if self._running.get(handle.session_id) is handle:
                self._running.pop(handle.session_id, None)
            if handle.holds_lock:
                handle.holds_lock = False
                handle.session_lock.release()
            if not handles:
                self._handles.pop(handle.session_id, None)
                self._session_locks.pop(handle.session_id, None)

    async def status(self, session_id: str) -> dict[str, Any]:
        async with self._guard:
            handles = [
                handle
                for handle in self._handles.get(session_id, [])
                if handle.state in {"queued", "running"}
            ]
            running = self._running.get(session_id)
            return {
                "active": bool(handles),
                "running": running is not None and running.state == "running",
                "run_id": (
                    running.run_id
                    if running is not None
                    else handles[0].run_id
                    if handles
                    else None
                ),
                "queued_run_ids": [
                    handle.run_id for handle in handles if handle.state == "queued"
                ],
            }

    async def has_active_streams(self) -> bool:
        async with self._guard:
            return any(self._handles.values())

    async def has_session_streams(self, session_id: str) -> bool:
        async with self._guard:
            return bool(self._handles.get(session_id))


_GENERATION_DONE = object()


async def coordinated_generation(
    coordinator: SessionStreamCoordinator,
    handle: SessionRunHandle,
    generation: AsyncIterator,
) -> AsyncIterator[tuple[str, Any]]:
    """Pump provider output in a cancellable child while keeping the SSE task alive."""
    queue: asyncio.Queue = asyncio.Queue()

    async def pump() -> None:
        try:
            async for item in generation:
                await queue.put(item)
        finally:
            queue.put_nowait(_GENERATION_DONE)

    task = asyncio.create_task(pump())
    await coordinator.set_execution_task(handle, task)
    try:
        while True:
            item = await queue.get()
            if item is _GENERATION_DONE:
                try:
                    await task
                except asyncio.CancelledError as exc:
                    if handle.interrupt_requested:
                        raise RunInterrupted(handle.run_id) from exc
                    raise
                return
            yield item
    finally:
        if not task.done():
            task.cancel()
            with suppress(asyncio.CancelledError, Exception):
                await task
        await coordinator.set_execution_task(handle, None)
