import asyncio
import threading
import time

import pytest

from app.core.async_support import run_blocking, run_blocking_cleanup


def test_run_blocking_keeps_the_event_loop_responsive():
    async def exercise() -> None:
        started = threading.Event()
        release = threading.Event()

        def blocking_operation() -> str:
            started.set()
            release.wait(timeout=1)
            return "done"

        worker = asyncio.create_task(run_blocking(blocking_operation))
        while not started.is_set():
            await asyncio.sleep(0)

        heartbeat = asyncio.create_task(asyncio.sleep(0.01, result="responsive"))
        assert await asyncio.wait_for(heartbeat, timeout=0.1) == "responsive"
        assert not worker.done()

        release.set()
        assert await asyncio.wait_for(worker, timeout=0.5) == "done"

    asyncio.run(exercise())


def test_run_blocking_cleanup_finishes_after_cancellation():
    completed = threading.Event()

    def blocking_cleanup() -> None:
        time.sleep(0.02)
        completed.set()

    async def exercise() -> None:
        started = asyncio.Event()

        async def cancellable_work() -> None:
            try:
                started.set()
                await asyncio.Future()
            except asyncio.CancelledError:
                await run_blocking_cleanup(blocking_cleanup)
                raise

        task = asyncio.create_task(cancellable_work())
        await started.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(exercise())
    assert completed.is_set()
