from __future__ import annotations

import json
import sqlite3

from app.core.schemas import ModelProfileCreate, ModelProfileUpdate
from app.llm.reasoning import (
    REASONING_EFFORTS,
    normalize_reasoning_effort_options,
    preferred_reasoning_effort,
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
                reasoning_options = normalize_reasoning_effort_options(
                    payload.reasoning_effort_options
                )
                selected_effort = preferred_reasoning_effort(
                    payload.reasoning_effort,
                    reasoning_options,
                )
                conn.execute(
                    """
                    INSERT INTO model_profiles (
                      id, display_name, provider, base_url, model, api_key_ciphertext,
                      api_key_mask, tags_json, enabled, timeout_ms, temperature,
                      max_output_tokens, is_multimodal, reasoning_effort,
                      reasoning_effort_options_json, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)
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
                        selected_effort,
                        json.dumps(reasoning_options, ensure_ascii=False),
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
                ORDER BY created_at DESC
                """
            ).fetchall()

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
        current = self.get(profile_id)
        changes = payload.model_dump(exclude_unset=True)
        assignments: list[str] = []
        values: list[object] = []
        identity_changed = any(
            changes.get(field) is not None
            for field in (
                "provider",
                "base_url",
                "model",
                "api_key",
                "timeout_ms",
                "max_output_tokens",
            )
        )

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
        options_changed = (
            "reasoning_effort_options" in changes
            and changes["reasoning_effort_options"] is not None
        )
        if options_changed:
            reasoning_options = normalize_reasoning_effort_options(
                changes["reasoning_effort_options"]
            )
        elif identity_changed:
            reasoning_options = REASONING_EFFORTS
        else:
            reasoning_options = normalize_reasoning_effort_options(
                _decode_reasoning_options(current["reasoning_effort_options_json"])
            )
        if options_changed or identity_changed:
            assignments.append("reasoning_effort_options_json = ?")
            values.append(json.dumps(reasoning_options, ensure_ascii=False))
        if (
            "reasoning_effort" in changes
            and changes["reasoning_effort"] is not None
        ) or options_changed or identity_changed:
            selected_effort = preferred_reasoning_effort(
                changes.get("reasoning_effort") or current["reasoning_effort"],
                reasoning_options,
            )
            assignments.append("reasoning_effort = ?")
            values.append(selected_effort)
        if changes.get("api_key"):
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

    def update_reasoning_effort(self, profile_id: str, reasoning_effort: str) -> sqlite3.Row:
        """Persist a user-selected reasoning preference."""
        ts = now_iso()
        with self.db.connect() as conn:
            cursor = conn.execute(
                """
                UPDATE model_profiles
                SET reasoning_effort = ?, updated_at = ?
                WHERE id = ? AND deleted_at IS NULL
                """,
                (reasoning_effort, ts, profile_id),
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

def _decode_reasoning_options(raw: object) -> list[str] | None:
    try:
        decoded = json.loads(str(raw))
    except (TypeError, json.JSONDecodeError):
        return None
    if not isinstance(decoded, list):
        return None
    return [str(item) for item in decoded]
