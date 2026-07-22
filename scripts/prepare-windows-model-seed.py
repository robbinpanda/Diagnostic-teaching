from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
API_ROOT = REPO_ROOT / "apps" / "api"
sys.path.insert(0, str(API_ROOT))

from app.services.model_profile_seed import prepare_seed_bundle, public_probe_summary  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Probe personal LLM profiles and create an encrypted Windows seed database."
    )
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument(
        "--allow-unavailable",
        action="store_true",
        help="Seed profiles that fail the text probe and mark their last test status as error.",
    )
    args = parser.parse_args()

    results = prepare_seed_bundle(
        args.input,
        args.output_dir,
        allow_unavailable=args.allow_unavailable,
    )
    print(json.dumps([public_probe_summary(result) for result in results], ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
