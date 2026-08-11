from __future__ import annotations

import asyncio
from collections.abc import Callable
from typing import ParamSpec, TypeVar

P = ParamSpec("P")
T = TypeVar("T")


async def run_blocking(
    operation: Callable[P, T],
    /,
    *args: P.args,
    **kwargs: P.kwargs,
) -> T:
    """Run synchronous repository or file work without blocking the event loop."""

    return await asyncio.to_thread(operation, *args, **kwargs)


async def run_blocking_cleanup(
    operation: Callable[P, T],
    /,
    *args: P.args,
    **kwargs: P.kwargs,
) -> T:
    """Finish durable blocking cleanup while the caller handles cancellation.

    The caller must re-raise the original ``CancelledError`` after this returns.
    """

    current = asyncio.current_task()
    if current is not None:
        while current.cancelling():
            current.uncancel()

    worker = asyncio.create_task(run_blocking(operation, *args, **kwargs))
    while True:
        try:
            return await asyncio.shield(worker)
        except asyncio.CancelledError:
            if current is not None:
                current.uncancel()
