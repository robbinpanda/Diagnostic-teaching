from __future__ import annotations

import asyncio
import gc
import hashlib
import json
import os
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from app.core.schemas import ModelProfileCreate
from app.llm.provider import LlmProfile, test_connection, test_multimodal_connection
from app.routes.model_profiles import multimodal_probe_challenge
from app.storage.database import Database
from app.storage.model_profiles import BUNDLED_PERSONAL_TAG, ModelProfileRepository
from app.storage.security import SecretBox

MAX_PARALLEL_PROBES = 4
SEED_DATABASE_NAME = "app.db"
SEED_SECRET_NAME = "app-secret.key"


@dataclass(frozen=True)
class SeedProbeResult:
    profile: ModelProfileCreate
    text_ok: bool
    text_latency_ms: int | None
    multimodal_ok: bool
    multimodal_latency_ms: int | None


@dataclass(frozen=True)
class BundledSeedSyncResult:
    status: str
    fingerprint: str | None = None
    created: int = 0
    updated: int = 0
    disabled: int = 0


def load_seed_profiles(input_path: Path) -> list[ModelProfileCreate]:
    try:
        payload = json.loads(input_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"无法读取模型预置文件：{input_path}") from exc
    providers = payload.get("providers") if isinstance(payload, dict) else None
    if not isinstance(providers, list) or not providers:
        raise ValueError("模型预置文件必须包含非空 providers 数组")

    profiles: list[ModelProfileCreate] = []
    for provider_index, raw_provider in enumerate(providers, start=1):
        if not isinstance(raw_provider, dict):
            raise ValueError(f"providers[{provider_index}] 必须是 object")
        display_name = raw_provider.get("display_name")
        api_key = raw_provider.get("api_key")
        base_url = raw_provider.get("base_url")
        protocol = raw_provider.get("provider", "openai_compatible")
        raw_models = raw_provider.get("models")
        if not isinstance(raw_models, list) or not raw_models:
            raise ValueError(f"providers[{provider_index}].models 必须是非空数组")
        models: list[tuple[str, bool]] = []
        for raw_model in raw_models:
            if isinstance(raw_model, str):
                models.append((raw_model.strip(), False))
                continue
            if isinstance(raw_model, dict):
                model_name = raw_model.get("model")
                is_multimodal = raw_model.get("is_multimodal", False)
                if not isinstance(model_name, str) or not isinstance(is_multimodal, bool):
                    raise ValueError(
                        f"providers[{provider_index}].models 的 object 必须包含 model 和布尔 is_multimodal"
                    )
                models.append((model_name.strip(), is_multimodal))
                continue
            raise ValueError(
                f"providers[{provider_index}].models 只能包含 model 字符串或 object"
            )
        if any(not model for model, _ in models):
            raise ValueError(f"providers[{provider_index}].models 不能包含空 model")
        model_names = [model for model, _ in models]
        if len(set(model_names)) != len(model_names):
            raise ValueError(f"providers[{provider_index}].models 不能重复")
        for model, is_multimodal in models:
            try:
                profiles.append(
                    ModelProfileCreate(
                        display_name=display_name,
                        provider=protocol,
                        base_url=base_url,
                        api_key=api_key,
                        model=model,
                        tags=["math", BUNDLED_PERSONAL_TAG],
                        timeout_ms=60000,
                        temperature=0.2,
                        max_output_tokens=8000,
                        is_multimodal=is_multimodal,
                    )
                )
            except ValidationError as exc:
                raise ValueError(
                    f"providers[{provider_index}] 的供应商或模型配置无效"
                ) from exc
    return profiles


async def probe_seed_profiles(
    profiles: list[ModelProfileCreate],
) -> list[SeedProbeResult]:
    semaphore = asyncio.Semaphore(MAX_PARALLEL_PROBES)

    async def probe(profile: ModelProfileCreate) -> SeedProbeResult:
        async with semaphore:
            runtime_profile = LlmProfile(
                id="windows-installer-seed",
                provider=profile.provider,
                base_url=str(profile.base_url),
                api_key=profile.api_key,
                model=profile.model,
                timeout_ms=profile.timeout_ms,
                temperature=profile.temperature,
                max_output_tokens=profile.max_output_tokens,
            )
            text_ok, text_latency_ms, _ = await test_connection(runtime_profile)
            multimodal_ok = False
            multimodal_latency_ms: int | None = None
            if text_ok:
                image_data_url, expected_answer = multimodal_probe_challenge()
                multimodal_ok, multimodal_latency_ms, _ = await test_multimodal_connection(
                    runtime_profile,
                    image_data_url,
                    expected_answer,
                )
            return SeedProbeResult(
                profile=profile,
                text_ok=text_ok,
                text_latency_ms=text_latency_ms,
                multimodal_ok=multimodal_ok,
                multimodal_latency_ms=multimodal_latency_ms,
            )

    return list(await asyncio.gather(*(probe(profile) for profile in profiles)))


def prepare_seed_bundle(
    input_path: Path,
    output_directory: Path,
    *,
    allow_unavailable: bool = False,
) -> list[SeedProbeResult]:
    profiles = load_seed_profiles(input_path.resolve())
    results = asyncio.run(probe_seed_profiles(profiles))
    unavailable = [
        f"{result.profile.display_name} · {result.profile.model}"
        for result in results
        if not result.text_ok
    ]
    if unavailable and not allow_unavailable:
        joined = "、".join(unavailable)
        raise RuntimeError(f"以下模型未通过文字连接测试，已停止构建：{joined}")

    output_directory = output_directory.resolve()
    output_directory.mkdir(parents=True, exist_ok=True)
    database_path = output_directory / SEED_DATABASE_NAME
    working_database_path = output_directory / "seed-working.db"
    secret_path = output_directory / SEED_SECRET_NAME
    if database_path.exists() or working_database_path.exists() or secret_path.exists():
        raise FileExistsError("模型预置输出目录不是空目录，请先清理旧产物")

    database = Database(working_database_path)
    repository = ModelProfileRepository(database, SecretBox(secret_path))
    seeded_profiles = [
        result.profile.model_copy(
            update={"is_multimodal": result.multimodal_ok or result.profile.is_multimodal}
        )
        for result in results
    ]
    rows = repository.create_many(seeded_profiles)
    for row, result in zip(rows, results, strict=True):
        repository.update_test_status(
            row["id"],
            "ok" if result.text_ok else "error",
            result.text_latency_ms,
        )
    del rows, repository, database
    gc.collect()
    _finalize_seed_database(working_database_path, database_path)
    return results


def sync_bundled_model_seed(
    repository: ModelProfileRepository,
    seed_database_path: Path,
    seed_secret_path: Path,
    state_path: Path,
    *,
    bundle_version: str,
) -> BundledSeedSyncResult:
    """Apply each encrypted installer snapshot once to a user's existing database."""
    database_exists = seed_database_path.is_file()
    secret_exists = seed_secret_path.is_file()
    if not database_exists and not secret_exists:
        return BundledSeedSyncResult(status="not_bundled")
    if not database_exists or not secret_exists:
        raise RuntimeError("安装包中的模型预置数据库或密钥不完整")

    fingerprint = _seed_bundle_fingerprint(seed_database_path, seed_secret_path)
    if _read_seed_state_fingerprint(state_path) == fingerprint:
        return BundledSeedSyncResult(status="already_applied", fingerprint=fingerprint)

    seed_secrets = SecretBox(seed_secret_path)
    seed_profiles: list[tuple[ModelProfileCreate, str | None, int | None]] = []
    connection = sqlite3.connect(
        f"{seed_database_path.resolve().as_uri()}?mode=ro",
        uri=True,
    )
    connection.row_factory = sqlite3.Row
    try:
        rows = connection.execute(
            "SELECT * FROM model_profiles WHERE tags_json LIKE ? ORDER BY created_at ASC",
            (f'%"{BUNDLED_PERSONAL_TAG}"%',),
        ).fetchall()
    finally:
        connection.close()
    if not rows:
        raise RuntimeError("安装包模型预置库中没有可导入的个人模型")

    for row in rows:
        try:
            tags = json.loads(row["tags_json"])
        except (TypeError, json.JSONDecodeError) as exc:
            raise RuntimeError("安装包模型预置标签无效") from exc
        if not isinstance(tags, list) or BUNDLED_PERSONAL_TAG not in tags:
            raise RuntimeError("安装包模型预置缺少 bundled-personal 标签")
        seed_profiles.append(
            (
                ModelProfileCreate(
                    display_name=row["display_name"],
                    provider=row["provider"],
                    base_url=row["base_url"],
                    api_key=seed_secrets.decrypt(row["api_key_ciphertext"]),
                    model=row["model"],
                    tags=tags,
                    timeout_ms=row["timeout_ms"],
                    temperature=row["temperature"],
                    max_output_tokens=row["max_output_tokens"],
                    is_multimodal=bool(row["is_multimodal"]),
                ),
                row["last_test_status"],
                row["last_test_latency_ms"],
            )
        )

    created_ids, updated_ids, disabled_ids = repository.sync_bundled_personal_profiles(
        seed_profiles
    )
    _write_seed_state(state_path, bundle_version=bundle_version, fingerprint=fingerprint)
    return BundledSeedSyncResult(
        status="applied",
        fingerprint=fingerprint,
        created=len(created_ids),
        updated=len(updated_ids),
        disabled=len(disabled_ids),
    )


def _seed_bundle_fingerprint(database_path: Path, secret_path: Path) -> str:
    digest = hashlib.sha256()
    for path in (database_path, secret_path):
        with path.open("rb") as source:
            while chunk := source.read(1024 * 1024):
                digest.update(chunk)
    return digest.hexdigest()


def _read_seed_state_fingerprint(state_path: Path) -> str | None:
    try:
        payload = json.loads(state_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    fingerprint = payload.get("fingerprint") if isinstance(payload, dict) else None
    return fingerprint if isinstance(fingerprint, str) else None


def _write_seed_state(state_path: Path, *, bundle_version: str, fingerprint: str) -> None:
    state_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = state_path.with_name(f"{state_path.name}.tmp")
    temporary_path.write_text(
        json.dumps(
            {"bundle_version": bundle_version, "fingerprint": fingerprint},
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    os.replace(temporary_path, state_path)


def _finalize_seed_database(working_path: Path, output_path: Path) -> None:
    """Back up WAL content into the single database file packaged by electron-builder."""
    source = sqlite3.connect(working_path)
    destination = sqlite3.connect(output_path)
    try:
        source.backup(destination)
        destination.execute("PRAGMA journal_mode=DELETE").fetchone()
    finally:
        destination.close()
        source.close()
    for suffix in ("", "-wal", "-shm"):
        candidate = Path(f"{working_path}{suffix}")
        if candidate.exists():
            candidate.unlink()


def public_probe_summary(result: SeedProbeResult) -> dict[str, Any]:
    return {
        "display_name": result.profile.display_name,
        "model": result.profile.model,
        "text_ok": result.text_ok,
        "text_latency_ms": result.text_latency_ms,
        "multimodal_ok": result.multimodal_ok,
        "multimodal_latency_ms": result.multimodal_latency_ms,
        "multimodal_override": result.profile.is_multimodal,
        "seeded_as_multimodal": result.multimodal_ok or result.profile.is_multimodal,
    }
