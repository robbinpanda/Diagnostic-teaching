from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.services import model_profile_seed
from app.services.model_profile_seed import SeedProbeResult, load_seed_profiles, prepare_seed_bundle
from app.storage.database import Database
from app.storage.model_profiles import ModelProfileRepository
from app.storage.security import SecretBox


def write_seed_input(path: Path, *, models: list[str] | None = None) -> str:
    api_key = "sk-test-seed-key-that-must-not-remain-plaintext"
    path.write_text(
        json.dumps(
            {
                "providers": [
                    {
                        "display_name": "测试供应商",
                        "provider": "openai_compatible",
                        "base_url": "https://example.com/v1",
                        "api_key": api_key,
                        "models": models or ["text-model", "vision-model"],
                    }
                ]
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    return api_key


def test_load_seed_profiles_rejects_duplicate_models(tmp_path: Path):
    input_path = tmp_path / "seed.json"
    write_seed_input(input_path, models=["same-model", "same-model"])

    with pytest.raises(ValueError, match="不能重复"):
        load_seed_profiles(input_path)


def test_prepare_seed_bundle_encrypts_keys_and_persists_probe_result(
    monkeypatch, tmp_path: Path
):
    input_path = tmp_path / "seed.json"
    output_directory = tmp_path / "bundle"
    raw_api_key = write_seed_input(input_path)

    async def fake_probe(profiles):
        return [
            SeedProbeResult(
                profile=profile,
                text_ok=True,
                text_latency_ms=10 + index,
                multimodal_ok=profile.model == "vision-model",
                multimodal_latency_ms=20 + index,
            )
            for index, profile in enumerate(profiles)
        ]

    monkeypatch.setattr(model_profile_seed, "probe_seed_profiles", fake_probe)
    results = prepare_seed_bundle(input_path, output_directory)

    database_path = output_directory / "app.db"
    secret_path = output_directory / "app-secret.key"
    assert len(results) == 2
    assert not (output_directory / "app.db-wal").exists()
    assert not (output_directory / "app.db-shm").exists()
    assert raw_api_key.encode() not in database_path.read_bytes()
    assert raw_api_key.encode() not in secret_path.read_bytes()

    repository = ModelProfileRepository(Database(database_path), SecretBox(secret_path))
    rows = repository.list_public()
    by_model = {row["model"]: row for row in rows}
    assert repository.decrypt_api_key(by_model["text-model"]) == raw_api_key
    assert by_model["text-model"]["is_multimodal"] == 0
    assert by_model["vision-model"]["is_multimodal"] == 1
    assert {row["last_test_status"] for row in rows} == {"ok"}
