import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
API_DIR = ROOT / "apps" / "api"


def _locked_requirement_blocks(content: str) -> list[str]:
    blocks: list[str] = []
    current: list[str] = []

    for line in content.splitlines():
        if line and not line[0].isspace() and not line.startswith(("#", "-")):
            if current:
                blocks.append("\n".join(current))
            current = [line]
        elif current:
            current.append(line)

    if current:
        blocks.append("\n".join(current))
    return blocks


def test_core_lock_pins_and_hashes_every_resolved_dependency():
    lock = (API_DIR / "requirements-core.txt").read_text(encoding="utf-8")
    blocks = _locked_requirement_blocks(lock)

    assert "scripts\\lock-python-deps.cmd" in lock
    assert blocks
    assert all(re.match(r"^[A-Za-z0-9_.-]+==[^ ]+ \\", block) for block in blocks)
    assert all("--hash=sha256:" in block for block in blocks)


def test_core_lock_has_a_reproducible_generation_entrypoint():
    inputs = (API_DIR / "requirements-core.in").read_text(encoding="utf-8")
    tools = (API_DIR / "requirements-lock.txt").read_text(encoding="utf-8")
    script = (ROOT / "scripts" / "lock-python-deps.cmd").read_text(
        encoding="utf-8"
    )

    for dependency in (
        "fastapi",
        "uvicorn",
        "httpx",
        "cryptography",
        "python-dotenv",
        "pillow",
        "alembic",
        "sqlalchemy",
    ):
        assert re.search(rf"(?im)^{re.escape(dependency)}[<=>]", inputs)

    assert tools.strip() == "pip-tools==7.6.0"
    assert "--generate-hashes" in script
    assert "apps/api/requirements-core.in" in script
    assert "apps/api/requirements-core.txt" in script


def test_development_test_tools_are_exactly_pinned():
    development = (API_DIR / "requirements-dev.txt").read_text(encoding="utf-8")

    assert "ruff==0.15.22" in development
    assert "pytest==9.1.1" in development
    assert "httpx2==2.10.0" in development
