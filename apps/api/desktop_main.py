from __future__ import annotations

import os
from pathlib import Path

import uvicorn

from app.desktop import create_desktop_app


def main() -> None:
    web_root_value = os.environ.get("DESKTOP_WEB_ROOT")
    if not web_root_value:
        raise RuntimeError("DESKTOP_WEB_ROOT is required")

    port = int(os.environ.get("DIAGNOSTIC_TEACHING_PORT", "8010"))
    application = create_desktop_app(Path(web_root_value))
    server = uvicorn.Server(uvicorn.Config(
        application,
        host="127.0.0.1",
        port=port,
        loop="asyncio",
        http="h11",
        access_log=False,
        log_level="info",
    ))
    application.state.desktop_request_shutdown = lambda: setattr(server, "should_exit", True)
    server.run()


if __name__ == "__main__":
    main()
