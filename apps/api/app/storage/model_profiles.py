from __future__ import annotations

import json
import sqlite3

from app.core.schemas import ModelProfileCreate, ModelProfileUpdate
from app.llm.opencode_free_models import (
    OPENCODE_FREE_TAG,
    OPENCODE_PUBLIC_API_KEY,
    OpenCodeFreeModel,
)
from app.storage.database import Database
from app.storage.repository_utils import new_id, normalize_base_url, now_iso
from app.storage.security import SecretBox, mask_api_key


class ModelProfileRepository:
    def __init__(self, db: Database, secrets: SecretBox):
        self.db = db
        self.secrets = secrets

    def create(self, payload: ModelProfileCreate) -> sqlite3.Row:
        return self.create_many([payload])[0]

    def create_many(self, payloads: list[ModelProfileCreate]) -> list[sqlite3.Row]:
        if not payloads:
            return []
        ts = now_iso()
        profile_ids: list[str] = []
        with self.db.connect() as conn:
            for payload in payloads:
                profile_id = new_id("prof")
                profile_ids.append(profile_id)
                api_key = payload.api_key.strip()
                conn.execute(
                    """
                    INSERT INTO model_profiles (
                      id, display_name, provider, base_url, model, api_key_ciphertext,
                      api_key_mask, tags_json, enabled, timeout_ms, temperature,
                      max_output_tokens, is_multimodal, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        profile_id,
                        payload.display_name.strip(),
                        payload.provider,
                        normalize_base_url(str(payload.base_url)),
                        payload.model.strip(),
                        self.secrets.encrypt(api_key),
                        mask_api_key(api_key),
                        json.dumps(payload.tags, ensure_ascii=False),
                        payload.timeout_ms,
                        payload.temperature,
                        payload.max_output_tokens,
                        int(payload.is_multimodal),
                        ts,
                        ts,
                    ),
                )
        return [self.get(profile_id) for profile_id in profile_ids]

    def list_public(self) -> list[sqlite3.Row]:
        with self.db.connect() as conn:
            return conn.execute(
                """
                SELECT * FROM model_profiles
                WHERE deleted_at IS NULL AND enabled = 1
                ORDER BY
                  CASE WHEN tags_json LIKE '%"opencodefree"%' THEN 1 ELSE 0 END ASC,
                  CASE WHEN tags_json LIKE '%"opencodefree"%' THEN display_name END ASC,
                  created_at DESC
                """
            ).fetchall()

    def sync_opencode_free_models(self, models: tuple[OpenCodeFreeModel, ...]) -> list[sqlite3.Row]:
        ts = now_iso()
        desired_models = {model.model for model in models}
        synced_ids: list[str] = []
        encrypted_public_key = self.secrets.encrypt(OPENCODE_PUBLIC_API_KEY)
        public_key_mask = mask_api_key(OPENCODE_PUBLIC_API_KEY)
        with self.db.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            managed_rows = conn.execute(
                "SELECT * FROM model_profiles WHERE tags_json LIKE ?",
                (f'%"{OPENCODE_FREE_TAG}"%',),
            ).fetchall()
            by_model = {row["model"]: row for row in managed_rows}
            for model in models:
                existing = by_model.get(model.model)
                tags_json = json.dumps(["math", OPENCODE_FREE_TAG], ensure_ascii=False)
                if existing is None:
                    profile_id = new_id("prof")
                    conn.execute(
                        """
                        INSERT INTO model_profiles (
                          id, display_name, provider, base_url, model, api_key_ciphertext,
                          api_key_mask, tags_json, enabled, deleted_at, timeout_ms,
                          temperature, max_output_tokens, is_multimodal, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, 30000, 0.2, 8000, ?, ?, ?)
                        """,
                        (
                            profile_id,
                            model.display_name,
                            model.provider,
                            normalize_base_url(model.base_url),
                            model.model,
                            encrypted_public_key,
                            public_key_mask,
                            tags_json,
                            int(model.is_multimodal),
                            ts,
                            ts,
                        ),
                    )
                    synced_ids.append(profile_id)
                    continue
                profile_id = existing["id"]
                conn.execute(
                    """
                    UPDATE model_profiles
                    SET display_name = ?, provider = ?, base_url = ?, api_key_ciphertext = ?,
                        api_key_mask = ?, tags_json = ?, enabled = 1, deleted_at = NULL,
                        is_multimodal = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (
                        model.display_name,
                        model.provider,
                        normalize_base_url(model.base_url),
                        encrypted_public_key,
                        public_key_mask,
                        tags_json,
                        int(model.is_multimodal),
                        ts,
                        profile_id,
                    ),
                )
                synced_ids.append(profile_id)

            for row in managed_rows:
                if row["model"] in desired_models:
                    continue
                conn.execute(
                    "UPDATE model_profiles SET enabled = 0, updated_at = ? WHERE id = ?",
                    (ts, row["id"]),
                )
        return [self.get(profile_id) for profile_id in synced_ids]

    def get(self, profile_id: str) -> sqlite3.Row:
        with self.db.connect() as conn:
            row = conn.execute(
                "SELECT * FROM model_profiles WHERE id = ? AND deleted_at IS NULL",
                (profile_id,),
            ).fetchone()
        if row is None:
            raise KeyError(profile_id)
        return row

    def decrypt_api_key(self, row: sqlite3.Row) -> str:
        return self.secrets.decrypt(row["api_key_ciphertext"])

    def update(self, profile_id: str, payload: ModelProfileUpdate) -> sqlite3.Row:
        if self.is_managed(self.get(profile_id)):
            raise PermissionError(profile_id)
        changes = payload.model_dump(exclude_unset=True)
        assignments: list[str] = []
        values: list[object] = []

        if "display_name" in changes and changes["display_name"] is not None:
            assignments.append("display_name = ?")
            values.append(changes["display_name"].strip())
        if "provider" in changes and changes["provider"] is not None:
            assignments.append("provider = ?")
            values.append(changes["provider"])
        if "base_url" in changes and changes["base_url"] is not None:
            assignments.append("base_url = ?")
            values.append(normalize_base_url(str(changes["base_url"])))
        if "model" in changes and changes["model"] is not None:
            assignments.append("model = ?")
            values.append(changes["model"].strip())
        if "tags" in changes and changes["tags"] is not None:
            assignments.append("tags_json = ?")
            values.append(json.dumps(changes["tags"], ensure_ascii=False))
        if "timeout_ms" in changes and changes["timeout_ms"] is not None:
            assignments.append("timeout_ms = ?")
            values.append(changes["timeout_ms"])
        if "temperature" in changes and changes["temperature"] is not None:
            assignments.append("temperature = ?")
            values.append(changes["temperature"])
        if "max_output_tokens" in changes and changes["max_output_tokens"] is not None:
            assignments.append("max_output_tokens = ?")
            values.append(changes["max_output_tokens"])
        if "is_multimodal" in changes and changes["is_multimodal"] is not None:
            assignments.append("is_multimodal = ?")
            values.append(int(changes["is_multimodal"]))
        if "api_key" in changes and changes["api_key"]:
            api_key = changes["api_key"].strip()
            assignments.append("api_key_ciphertext = ?")
            values.append(self.secrets.encrypt(api_key))
            assignments.append("api_key_mask = ?")
            values.append(mask_api_key(api_key))

        if not assignments:
            return self.get(profile_id)

        assignments.append("updated_at = ?")
        values.append(now_iso())
        values.append(profile_id)
        with self.db.connect() as conn:
            cursor = conn.execute(
                f"""
                UPDATE model_profiles
                SET {", ".join(assignments)}
                WHERE id = ? AND deleted_at IS NULL
                """,
                tuple(values),
            )
        if cursor.rowcount == 0:
            raise KeyError(profile_id)
        return self.get(profile_id)

    def update_test_status(self, profile_id: str, status: str, latency_ms: int | None) -> None:
        with self.db.connect() as conn:
            conn.execute(
                """
                UPDATE model_profiles
                SET last_test_status = ?, last_test_latency_ms = ?, updated_at = ?
                WHERE id = ?
                """,
                (status, latency_ms, now_iso(), profile_id),
            )

    def soft_delete(self, profile_id: str) -> None:
        self.soft_delete_many([profile_id])

    def soft_delete_many(self, profile_ids: list[str]) -> list[str]:
        """Soft-delete profiles atomically after validating the complete selection."""
        unique_ids = list(dict.fromkeys(profile_ids))
        if not unique_ids:
            return []
        ts = now_iso()
        with self.db.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            placeholders = ", ".join("?" for _ in unique_ids)
            rows = conn.execute(
                f"""
                SELECT * FROM model_profiles
                WHERE id IN ({placeholders}) AND deleted_at IS NULL
                """,
                tuple(unique_ids),
            ).fetchall()
            rows_by_id = {row["id"]: row for row in rows}
            missing_ids = [profile_id for profile_id in unique_ids if profile_id not in rows_by_id]
            if missing_ids:
                raise KeyError(missing_ids[0])
            managed_ids = [
                profile_id
                for profile_id in unique_ids
                if self.is_managed(rows_by_id[profile_id])
            ]
            if managed_ids:
                raise PermissionError(managed_ids[0])
            cursor = conn.execute(
                f"""
                UPDATE model_profiles
                SET enabled = 0, deleted_at = ?, updated_at = ?
                WHERE id IN ({placeholders}) AND deleted_at IS NULL
                """,
                (ts, ts, *unique_ids),
            )
            if cursor.rowcount != len(unique_ids):
                raise RuntimeError("批量删除模型配置时写入数量不一致")
        return unique_ids

    @staticmethod
    def is_managed(row: sqlite3.Row) -> bool:
        try:
            tags = json.loads(row["tags_json"])
        except (TypeError, json.JSONDecodeError):
            return False
        return isinstance(tags, list) and OPENCODE_FREE_TAG in tags
