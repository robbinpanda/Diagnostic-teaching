import re
import runpy
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


def test_dependency_profiles_keep_hashed_core_in_a_separate_pip_invocation():
    installer = runpy.run_path(str(ROOT / "scripts" / "install-python-deps.py"))
    requirement_files = installer["requirement_files"]

    assert [path.name for path in requirement_files("ci")] == [
        "requirements-core.txt",
        "requirements-dev.txt",
    ]
    assert [path.name for path in requirement_files("dev")] == [
        "requirements-core.txt",
        "requirements-speech.txt",
        "requirements-dev.txt",
    ]
    assert [path.name for path in requirement_files("build")] == [
        "requirements-core.txt",
        "requirements-speech.txt",
        "requirements-build.txt",
    ]

    for filename in (
        "requirements-speech.txt",
        "requirements-dev.txt",
        "requirements-build.txt",
    ):
        content = (API_DIR / filename).read_text(encoding="utf-8")
        assert not any(line.lstrip().startswith("-r ") for line in content.splitlines())


def test_ci_and_windows_build_use_the_layered_dependency_installer():
    workflow = (ROOT / ".github" / "workflows" / "quality.yml").read_text(
        encoding="utf-8"
    )
    build_script = (ROOT / "scripts" / "build-windows-installer.ps1").read_text(
        encoding="utf-8"
    )

    assert "python ../../scripts/install-python-deps.py ci" in workflow
    assert '(Join-Path $repoRoot "scripts\\install-python-deps.py"), "build"' in build_script
    assert "Join-Path $root" not in build_script
