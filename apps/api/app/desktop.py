from __future__ import annotations

import os
import secrets
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles

from app.main import create_app

DESKTOP_CONTENT_SECURITY_POLICY = "; ".join(
    (
        "default-src 'self'",
        "base-uri 'self'",
        "connect-src 'self'",
        "font-src 'self' data:",
        "frame-ancestors 'none'",
        "img-src 'self' data: blob:",
        "object-src 'none'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline'",
    )
)


def create_desktop_app(web_root: Path) -> FastAPI:
    web_root = web_root.resolve()
    index_path = web_root / "index.html"
    if not index_path.is_file():
        raise RuntimeError(f"Desktop web bundle is missing: {index_path}")

    app = create_app()

    @app.post("/api/desktop/shutdown", include_in_schema=False)
    def shutdown_desktop_sidecar(request: Request) -> dict[str, bool]:
        expected = os.environ.get("DESKTOP_SHUTDOWN_TOKEN", "")
        supplied = request.headers.get("X-Desktop-Shutdown-Token", "")
        if not expected or not secrets.compare_digest(expected, supplied):
            raise HTTPException(status_code=404, detail="Not found")
        request_shutdown = getattr(request.app.state, "desktop_request_shutdown", None)
        if request_shutdown is None:
            raise HTTPException(status_code=503, detail="Shutdown is unavailable")
        request_shutdown()
        return {"ok": True}

    @app.middleware("http")
    async def add_desktop_security_headers(request: Request, call_next) -> Response:
        response = await call_next(request)
        response.headers["Content-Security-Policy"] = DESKTOP_CONTENT_SECURITY_POLICY
        response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        return response

    # API routes are registered before this catch-all mount, so /api/* remains
    # handled by FastAPI while the exported Next.js app is served at the root.
    app.mount("/", StaticFiles(directory=web_root, html=True), name="desktop-web")
    return app
