from __future__ import annotations

import json
import sqlite3

from app.core.schemas import TutorCheckpoint
from app.storage.repository_utils import new_id, now_iso


class SessionHistoryRepositoryMixin:
    def list_messages(self, session_id: str, limit: int | None = None) -> list[sqlite3.Row]:
        with self.db.connect() as conn:
            if limit is None:
                return conn.execute(
                    """
                    SELECT m.*, si.idempotency_key AS client_message_id
                    FROM messages m
                    LEFT JOIN session_inputs si
                      ON si.message_id = m.id AND si.kind = 'STUDENT_MESSAGE'
                    WHERE m.session_id = ?
                    ORDER BY m.created_at ASC, m.rowid ASC
                    """,
                    (session_id,),
                ).fetchall()
            rows = conn.execute(
                """
                SELECT m.*, si.idempotency_key AS client_message_id
                FROM messages m
                LEFT JOIN session_inputs si
                  ON si.message_id = m.id AND si.kind = 'STUDENT_MESSAGE'
                WHERE m.session_id = ?
                ORDER BY m.created_at DESC, m.rowid DESC
                LIMIT ?
                """,
                (session_id, limit),
            ).fetchall()
        return list(reversed(rows))

    def list_inputs(self, session_id: str) -> list[sqlite3.Row]:
        with self.db.connect() as conn:
            return conn.execute(
                """
                SELECT * FROM session_inputs
                WHERE session_id = ?
                ORDER BY created_at ASC, rowid ASC
                """,
                (session_id,),
            ).fetchall()

    def latest_blocking_action_id(self, session_id: str) -> str | None:
        with self.db.connect() as conn:
            row = conn.execute(
                """
                SELECT action_id FROM messages
                WHERE session_id = ? AND role = 'assistant'
                  AND action IN ('ASK_OPEN_QUESTION', 'ASK_MULTIPLE_CHOICE')
                ORDER BY created_at DESC, rowid DESC
                LIMIT 1
                """,
                (session_id,),
            ).fetchone()
            if not row or not row["action_id"]:
                return None
            answered = conn.execute(
                """
                SELECT 1 FROM messages
                WHERE session_id = ? AND role = 'student' AND in_reply_to_action_id = ?
                LIMIT 1
                """,
                (session_id, row["action_id"]),
            ).fetchone()
        return None if answered else row["action_id"]

    def create_checkpoint(
        self,
        session_id: str,
        checkpoint: TutorCheckpoint,
        *,
        source_action_id: str,
    ) -> sqlite3.Row:
        correct = [opt for opt in checkpoint.options if opt.is_correct]
        checkpoint_id = new_id("chk")
        with self.db.connect() as conn:
            conn.execute(
                """
                INSERT INTO checkpoints (
                  id, session_id, question, options_json, correct_option_id,
                  tested_point, source_action_id, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    checkpoint_id,
                    session_id,
                    checkpoint.question,
                    checkpoint.model_dump_json(),
                    correct[0].id,
                    checkpoint.tested_point,
                    source_action_id,
                    now_iso(),
                ),
            )
            conn.execute(
                "UPDATE sessions SET updated_at = ? WHERE id = ?",
                (now_iso(), session_id),
            )
        return self.get_checkpoint(checkpoint_id)

    def get_checkpoint(self, checkpoint_id: str) -> sqlite3.Row:
        with self.db.connect() as conn:
            row = conn.execute("SELECT * FROM checkpoints WHERE id = ?", (checkpoint_id,)).fetchone()
        if row is None:
            raise KeyError(checkpoint_id)
        return row

    def list_checkpoints(self, session_id: str) -> list[sqlite3.Row]:
        with self.db.connect() as conn:
            return conn.execute(
                """
                SELECT * FROM checkpoints
                WHERE session_id = ?
                ORDER BY created_at ASC, rowid ASC
                """,
                (session_id,),
            ).fetchall()

    def list_history(self) -> list[sqlite3.Row]:
        with self.db.connect() as conn:
            return conn.execute(
                """
                SELECT s.*,
                       CASE
                         WHEN mp.id IS NULL THEN '已删除的模型'
                         ELSE mp.display_name || ' · ' || mp.model
                       END AS model_display_name,
                       (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) AS message_count,
                       (SELECT COUNT(*) FROM checkpoints c WHERE c.session_id = s.id) AS checkpoint_count,
                       (SELECT m.content FROM messages m
                        WHERE m.session_id = s.id AND m.role = 'student'
                        ORDER BY m.created_at ASC, m.rowid ASC LIMIT 1) AS first_student_message
                FROM sessions s
                LEFT JOIN model_profiles mp ON mp.id = s.model_profile_id
                ORDER BY s.updated_at DESC
                """
            ).fetchall()

    def restore(self, source_session_id: str, model_profile_id: str) -> sqlite3.Row:
        """Copy one SQLite session into a new resumable session."""
        source = self.get(source_session_id)
        messages = self.list_messages(source_session_id)
        inputs = self.list_inputs(source_session_id)
        checkpoints = self.list_checkpoints(source_session_id)
        cards = [
            card
            for card in self.list_cards(source_session_id, include_pending=True)
            if card["saved_at"] is None
        ]
        new_session_id = new_id("sess")
        ts = now_iso()
        action_ids = {
            message["action_id"]
            for message in messages
            if message["action_id"]
        }
        action_map = {action_id: new_id("act") for action_id in action_ids}
        checkpoint_map = {checkpoint["id"]: new_id("chk") for checkpoint in checkpoints}
        message_map = {message["id"]: new_id("msg") for message in messages}
        card_map = {card["id"]: new_id("card") for card in cards}

        with self.db.connect() as conn:
            conn.execute(
                """
                INSERT INTO sessions (
                  id, grade_band, subject, model_profile_id, problem_text,
                  problem_image_data_url, student_initial_thought, phase,
                  context_status, breakpoint_description, breakpoint_confidence, restored_from,
                  created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    new_session_id,
                    source["grade_band"],
                    source["subject"],
                    model_profile_id,
                    source["problem_text"],
                    source["problem_image_data_url"],
                    source["student_initial_thought"],
                    source["phase"],
                    source["context_status"],
                    source["breakpoint_description"],
                    source["breakpoint_confidence"],
                    source["id"],
                    ts,
                    ts,
                ),
            )

            for checkpoint in checkpoints:
                conn.execute(
                    """
                    INSERT INTO checkpoints (
                      id, session_id, question, options_json, correct_option_id,
                      tested_point, source_action_id, selected_option_id,
                      is_correct, elapsed_ms, created_at, answered_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        checkpoint_map[checkpoint["id"]],
                        new_session_id,
                        checkpoint["question"],
                        checkpoint["options_json"],
                        checkpoint["correct_option_id"],
                        checkpoint["tested_point"],
                        action_map.get(checkpoint["source_action_id"], checkpoint["source_action_id"]),
                        checkpoint["selected_option_id"],
                        checkpoint["is_correct"],
                        checkpoint["elapsed_ms"],
                        checkpoint["created_at"],
                        checkpoint["answered_at"],
                    ),
                )

            for message in messages:
                try:
                    metadata = json.loads(message["metadata_json"] or "{}")
                except json.JSONDecodeError:
                    metadata = {}
                if metadata.get("checkpoint_id") in checkpoint_map:
                    metadata["checkpoint_id"] = checkpoint_map[metadata["checkpoint_id"]]
                if metadata.get("card_id") in card_map:
                    metadata["card_id"] = card_map[metadata["card_id"]]
                elif metadata.get("card_id"):
                    # A card deleted from the library still remains as structured
                    # teaching history, but its old database id must not leak into
                    # the restored branch.
                    metadata["card_id"] = None
                result = metadata.get("checkpoint_result") or metadata.get("checkpoint_answer")
                if isinstance(result, dict) and result.get("checkpoint_id") in checkpoint_map:
                    result["checkpoint_id"] = checkpoint_map[result["checkpoint_id"]]
                conn.execute(
                    """
                    INSERT INTO messages (
                      id, session_id, role, content, action_id, action,
                      in_reply_to_action_id, metadata_json, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        message_map[message["id"]],
                        new_session_id,
                        message["role"],
                        message["content"],
                        action_map.get(message["action_id"], new_id("act")),
                        message["action"],
                        action_map.get(message["in_reply_to_action_id"], message["in_reply_to_action_id"]),
                        json.dumps(metadata, ensure_ascii=False),
                        message["created_at"],
                    ),
                )

            # Preserve ordinary-message idempotency in the explicit restored
            # branch. Checkpoint inputs are lazily backfilled from their copied
            # CHECKPOINT_RESPONSE message if an old answer is retried.
            for input_row in inputs:
                if input_row["kind"] != "STUDENT_MESSAGE":
                    continue
                if input_row["message_id"] not in message_map:
                    continue
                try:
                    result = json.loads(input_row["result_json"] or "{}")
                except json.JSONDecodeError:
                    result = {}
                if result.get("message_id") in message_map:
                    result["message_id"] = message_map[result["message_id"]]
                if result.get("action_id") in action_map:
                    result["action_id"] = action_map[result["action_id"]]
                if result.get("in_reply_to_action_id") in action_map:
                    result["in_reply_to_action_id"] = action_map[result["in_reply_to_action_id"]]
                conn.execute(
                    """
                    INSERT INTO session_inputs (
                      id, session_id, kind, idempotency_key, payload_json,
                      result_json, message_id, checkpoint_id, card_id, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)
                    """,
                    (
                        new_id("inp"),
                        new_session_id,
                        input_row["kind"],
                        input_row["idempotency_key"],
                        input_row["payload_json"],
                        json.dumps(result, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
                        message_map[input_row["message_id"]],
                        input_row["created_at"],
                    ),
                )

            for card in cards:
                conn.execute(
                    """
                    INSERT INTO study_cards (
                      id, session_id, live_session_id, card_type, title, content_json,
                      source_action_id, source_message_id, created_at, saved_at, folder_id
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        card_map[card["id"]],
                        new_session_id,
                        new_session_id,
                        card["card_type"],
                        card["title"],
                        card["content_json"],
                        action_map.get(card["source_action_id"], card["source_action_id"]),
                        message_map.get(card["source_message_id"], card["source_message_id"]),
                        card["created_at"],
                        card["saved_at"],
                        card["folder_id"],
                    ),
                )

            self.events.append_in_transaction(
                conn,
                new_session_id,
                [
                    (
                        "session.created",
                        {
                            "model_profile_id": model_profile_id,
                            "grade_band": source["grade_band"],
                            "subject": source["subject"],
                            "state_hint": source["phase"],
                            "context_status": source["context_status"],
                            "restored_from": source["id"],
                            "baseline_message_count": len(messages),
                            "baseline_checkpoint_count": len(checkpoints),
                            "baseline_pending_card_count": len(cards),
                        },
                    )
                ],
            )

        return self.get(new_session_id)
