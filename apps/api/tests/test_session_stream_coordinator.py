import asyncio

import pytest

from app.services.session_stream_coordinator import (
    SessionStreamCoordinator,
    coordinated_generation,
)


def test_generation_queue_applies_backpressure_to_fast_provider():
    async def exercise() -> None:
        coordinator = SessionStreamCoordinator()
        handle = await coordinator.enqueue("sess_backpressure", "run_backpressure")
        produced: list[int] = []

        async def fast_generation():
            for index in range(100):
                produced.append(index)
                yield "message_delta", str(index)

        stream = coordinated_generation(
            coordinator,
            handle,
            fast_generation(),
            queue_maxsize=1,
        )
        assert await anext(stream) == ("message_delta", "0")
        await asyncio.sleep(0.01)

        # One item may be buffered and one may be waiting in queue.put(); the
        # provider cannot run arbitrarily far ahead of the SSE consumer.
        assert produced == [0, 1, 2]

        remaining = [item async for item in stream]
        assert len(remaining) == 99
        await coordinator.finish(handle)

    asyncio.run(exercise())


def test_closing_slow_consumer_cancels_full_queue_without_deadlock():
    async def exercise() -> None:
        coordinator = SessionStreamCoordinator()
        handle = await coordinator.enqueue("sess_close", "run_close")
        provider_cancelled = asyncio.Event()

        async def endless_generation():
            try:
                index = 0
                while True:
                    yield "message_delta", str(index)
                    index += 1
            finally:
                provider_cancelled.set()

        stream = coordinated_generation(
            coordinator,
            handle,
            endless_generation(),
            queue_maxsize=1,
        )
        await anext(stream)
        await asyncio.sleep(0.01)
        await asyncio.wait_for(stream.aclose(), timeout=0.5)

        assert provider_cancelled.is_set()
        await coordinator.finish(handle)

    asyncio.run(exercise())


def test_provider_error_is_raised_after_buffered_items_are_drained():
    async def exercise() -> None:
        coordinator = SessionStreamCoordinator()
        handle = await coordinator.enqueue("sess_error", "run_error")

        async def failing_generation():
            yield "message_delta", "first"
            yield "message_delta", "second"
            raise RuntimeError("provider failed")

        received = []
        with pytest.raises(RuntimeError, match="provider failed"):
            async for item in coordinated_generation(
                coordinator,
                handle,
                failing_generation(),
                queue_maxsize=1,
            ):
                received.append(item)

        assert received == [
            ("message_delta", "first"),
            ("message_delta", "second"),
        ]
        await coordinator.finish(handle)

    asyncio.run(exercise())


def test_generation_queue_rejects_unbounded_capacity():
    async def exercise() -> None:
        coordinator = SessionStreamCoordinator()
        handle = await coordinator.enqueue("sess_invalid", "run_invalid")

        async def empty_generation():
            if False:
                yield None

        with pytest.raises(ValueError, match="at least 1"):
            await anext(
                coordinated_generation(
                    coordinator,
                    handle,
                    empty_generation(),
                    queue_maxsize=0,
                )
            )
        await coordinator.finish(handle)

    asyncio.run(exercise())
