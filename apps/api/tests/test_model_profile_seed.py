from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.core.schemas import ModelProfileCreate, ModelProfileUpdate
from app.services import model_profile_seed
from app.services.model_profile_seed import (
    SeedProbeResult,
    load_seed_profiles,
    prepare_seed_bundle,
    sync_bundled_model_seed,
)
from app.storage.database import Database
from app.storage.model_profiles import BUNDLED_PERSONAL_TAG, ModelProfileRepository
from app.storage.security import SecretBox


def write_seed_input(path: Path, *, models: list[object] | None = None) -> str:
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


def test_load_seed_profiles_accepts_manual_multimodal_override(tmp_path: Path):
    input_path = tmp_path / "seed.json"
    write_seed_input(
        input_path,
        models=[{"model": "busy-vision-model", "is_multimodal": True}],
    )

    profiles = load_seed_profiles(input_path)

    assert profiles[0].model == "busy-vision-model"
    assert profiles[0].is_multimodal is True


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


def test_allow_unavailable_seeds_error_status_and_manual_multimodal_override(
    monkeypatch, tmp_path: Path
):
    input_path = tmp_path / "seed.json"
    output_directory = tmp_path / "bundle"
    write_seed_input(
        input_path,
        models=[{"model": "busy-vision-model", "is_multimodal": True}],
    )

    async def fake_probe(profiles):
        return [
            SeedProbeResult(
                profile=profiles[0],
                text_ok=False,
                text_latency_ms=503,
                multimodal_ok=False,
                multimodal_latency_ms=None,
            )
        ]

    monkeypatch.setattr(model_profile_seed, "probe_seed_profiles", fake_probe)
    prepare_seed_bundle(input_path, output_directory, allow_unavailable=True)

    repository = ModelProfileRepository(
        Database(output_directory / "app.db"),
        SecretBox(output_directory / "app-secret.key"),
    )
    row = repository.list_public()[0]
    assert row["last_test_status"] == "error"
    assert row["is_multimodal"] == 1


def test_bundled_seed_updates_existing_profiles_once_and_preserves_custom_profiles(
    monkeypatch, tmp_path: Path
):
    input_path = tmp_path / "seed.json"
    bundle_directory = tmp_path / "bundle"
    raw_api_key = write_seed_input(input_path, models=["text-model", "new-model"])

    async def fake_probe(profiles):
        return [
            SeedProbeResult(
                profile=profile,
                text_ok=True,
                text_latency_ms=40 + index,
                multimodal_ok=profile.model == "new-model",
                multimodal_latency_ms=80 + index,
            )
            for index, profile in enumerate(profiles)
        ]

    monkeypatch.setattr(model_profile_seed, "probe_seed_profiles", fake_probe)
    prepare_seed_bundle(input_path, bundle_directory)

    user_database = Database(tmp_path / "user" / "app.db")
    user_repository = ModelProfileRepository(
        user_database,
        SecretBox(tmp_path / "user" / "app-secret.key"),
    )
    previous = user_repository.create(
        ModelProfileCreate(
            display_name="旧预置供应商",
            base_url="https://old.example.com/v1",
            api_key="sk-old-bundled-key",
            model="text-model",
            tags=["math", BUNDLED_PERSONAL_TAG],
        )
    )
    removed = user_repository.create(
        ModelProfileCreate(
            display_name="已移除预置",
            base_url="https://old.example.com/v1",
            api_key="sk-old-removed-key",
            model="removed-model",
            tags=["math", BUNDLED_PERSONAL_TAG],
        )
    )
    custom = user_repository.create(
        ModelProfileCreate(
            display_name="用户自定义",
            base_url="https://custom.example.com/v1",
            api_key="sk-user-custom-key",
            model="custom-model",
            tags=["math"],
        )
    )
    state_path = tmp_path / "user" / "bundled-model-seed-state.json"

    result = sync_bundled_model_seed(
        user_repository,
        bundle_directory / "app.db",
        bundle_directory / "app-secret.key",
        state_path,
        bundle_version="0.4.0",
    )

    assert result.status == "applied"
    assert (result.created, result.updated, result.disabled) == (1, 1, 1)
    updated = user_repository.get(previous["id"])
    assert updated["display_name"] == "测试供应商"
    assert updated["base_url"] == "https://example.com/v1"
    assert updated["last_test_status"] == "ok"
    assert user_repository.decrypt_api_key(updated) == raw_api_key
    assert user_repository.get(custom["id"])["display_name"] == "用户自定义"
    with user_database.connect() as connection:
        assert connection.execute(
            "SELECT enabled FROM model_profiles WHERE id = ?", (removed["id"],)
        ).fetchone()["enabled"] == 0

    user_repository.update(
        previous["id"],
        ModelProfileUpdate(display_name="用户在安装后修改的名称"),
    )
    second_result = sync_bundled_model_seed(
        user_repository,
        bundle_directory / "app.db",
        bundle_directory / "app-secret.key",
        state_path,
        bundle_version="0.4.0",
    )

    assert second_result.status == "already_applied"
    assert user_repository.get(previous["id"])["display_name"] == "用户在安装后修改的名称"
    assert raw_api_key not in state_path.read_text(encoding="utf-8")
