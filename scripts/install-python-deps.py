from __future__ import annotations

import argparse
from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
API_DIR = ROOT / "apps" / "api"
PROFILE_LAYERS = {
    "core": ("requirements-core.txt",),
    "runtime": ("requirements-core.txt", "requirements-speech.txt"),
    "dev": (
        "requirements-core.txt",
        "requirements-speech.txt",
        "requirements-dev.txt",
    ),
    "ci": ("requirements-core.txt", "requirements-dev.txt"),
    "build": (
        "requirements-core.txt",
        "requirements-speech.txt",
        "requirements-build.txt",
    ),
}


def requirement_files(profile: str) -> tuple[Path, ...]:
    try:
        layers = PROFILE_LAYERS[profile]
    except KeyError as exc:
        raise ValueError(f"unknown dependency profile: {profile}") from exc
    return tuple(API_DIR / layer for layer in layers)


def install_profile(profile: str, *, dry_run: bool = False) -> None:
    for requirements in requirement_files(profile):
        relative_path = requirements.relative_to(ROOT)
        command = [
            sys.executable,
            "-m",
            "pip",
            "install",
            "--disable-pip-version-check",
            "-r",
            str(relative_path),
        ]
        print(f"[python-deps] {' '.join(command)}", flush=True)
        if not dry_run:
            subprocess.run(command, cwd=ROOT, check=True)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Install hashed core and optional Python dependency layers separately."
    )
    parser.add_argument("profile", choices=PROFILE_LAYERS, nargs="?", default="dev")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print pip commands without installing packages.",
    )
    args = parser.parse_args()
    install_profile(args.profile, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
