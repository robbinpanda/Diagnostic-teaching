from __future__ import annotations

import json
import sqlite3

from app.storage.repository_utils import new_id, now_iso
from app.storage.run_state import RunStateConflict


class SessionRunRepositoryMixin:
    def latest_pending_interruption(self, session_id: str) -> dict | None:
        with self.db.connect() as conn:
            rows = conn.execute(
                """
                SELECT * FROM messages
                WHERE session_id = ? AND action = 'INTERRUPTED_EXPLANATION'
                ORDER BY created_at DESC, rowid DESC
                """,
                (session_id,),
            ).fetchall()
        for row in rows:
            try:
                metadata = json.loads(row["metadata_json"] or "{}")
            except json.JSONDecodeError:
                continue
            if metadata.get("resume_state") in {
                "awaiting_question",
                "detour_active",
                "resuming",
            }:
                return {"row": row, "metadata": metadata}
        return None

    def set_interruption_resume_state(self, message_id: str, state: str) -> None:
        if state not in {"detour_active", "resuming", "resolved"}:
            raise ValueError(state)
        with self.db.connect() as conn:
            row = conn.execute(
                "SELECT metadata_json FROM messages WHERE id = ? AND action = 'INTERRUPTED_EXPLANATION'",
                (message_id,),
            ).fetchone()
            if row is None:
                raise KeyError(message_id)
            metadata = json.loads(row["metadata_json"] or "{}")
            metadata["resume_state"] = state
            metadata["resume_pending"] = state != "resolved"
            conn.execute(
                "UPDATE messages SET metadata_json = ? WHERE id = ?",
                (json.dumps(metadata, ensure_ascii=False, sort_keys=True), message_id),
            )

    def create_run(self, session_id: str) -> sqlite3.Row:
        """Atomically allocate the next per-session attempt in queued state."""
        run_id = new_id("run")
        ts = now_iso()
        with self.db.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            exists = conn.execute(
                "SELECT 1 FROM sessions WHERE id = ?",
                (session_id,),
            ).fetchone()
            if exists is None:
                raise KeyError(session_id)
            attempt = conn.execute(
                "SELECT COALESCE(MAX(attempt), 0) + 1 FROM session_runs WHERE session_id = ?",
                (session_id,),
            ).fetchone()[0]
            conn.execute(
                """
                INSERT INTO session_runs (
                  id, session_id, attempt, status, queued_at, updated_at
                ) VALUES (?, ?, ?, 'queued', ?, ?)
                """,
                (run_id, session_id, attempt, ts, ts),
            )
        return self.get_run(run_id)

    def get_run(self, run_id: str) -> sqlite3.Row:
        with self.db.connect() as conn:
            row = conn.execute(
                "SELECT * FROM session_runs WHERE id = ?",
                (run_id,),
            ).fetchone()
        if row is None:
            raise KeyError(run_id)
        return row

    def list_runs(self, session_id: str) -> list[sqlite3.Row]:
        with self.db.connect() as conn:
            return conn.execute(
                """
                SELECT * FROM session_runs
                WHERE session_id = ?
                ORDER BY attempt ASC
                """,
                (session_id,),
            ).fetchall()

    def latest_active_run(self, session_id: str) -> sqlite3.Row | None:
        with self.db.connect() as conn:
            return conn.execute(
                """
                SELECT * FROM session_runs
                WHERE session_id = ? AND status IN ('queued', 'running')
                ORDER BY attempt ASC
                LIMIT 1
                """,
                (session_id,),
            ).fetchone()

    def latest_run(self, session_id: str) -> sqlite3.Row | None:
        with self.db.connect() as conn:
            return conn.execute(
                """
                SELECT * FROM session_runs
                WHERE session_id = ?
                ORDER BY attempt DESC
                LIMIT 1
                """,
                (session_id,),
            ).fetchone()

    def mark_run_running(self, run_id: str) -> sqlite3.Row:
        ts = now_iso()
        with self.db.connect() as conn:
            cursor = conn.execute(
                """
                UPDATE session_runs
                SET status = 'running', started_at = COALESCE(started_at, ?), updated_at = ?
                WHERE id = ? AND status = 'queued'
                """,
                (ts, ts, run_id),
            )
            row = conn.execute(
                "SELECT * FROM session_runs WHERE id = ?",
                (run_id,),
            ).fetchone()
            if row is None:
                raise KeyError(run_id)
            if cursor.rowcount == 0 and row["status"] != "running":
                raise RunStateConflict(run_id, row["status"])
            if cursor.rowcount == 1:
                self.events.append_in_transaction(
                    conn,
                    row["session_id"],
                    [
                        (
                            "run.started",
                            {
                                "run_id": row["id"],
                                "attempt": row["attempt"],
                                "status": "running",
                                "queued_at": row["queued_at"],
                                "started_at": row["started_at"],
                            },
                        )
                    ],
                )
        return self.get_run(run_id)

    def mark_run_completed(self, run_id: str) -> sqlite3.Row:
        return self._finish_run(run_id, "completed", error=None)

    def mark_run_failed(self, run_id: str, error: dict) -> sqlite3.Row:
        return self._finish_run(run_id, "failed", error=error)

    def mark_run_interrupted(
        self,
        run_id: str,
        error: dict,
        *,
        partial_message: str | None = None,
    ) -> sqlite3.Row:
        return self._finish_run(
            run_id,
            "interrupted",
            error=error,
            partial_message=partial_message,
        )

    def _finish_run(
        self,
        run_id: str,
        status: str,
        *,
        error: dict | None,
        partial_message: str | None = None,
    ) -> sqlite3.Row:
        ts = now_iso()
        error_json = json.dumps(error, ensure_ascii=False) if error is not None else None
        with self.db.connect() as conn:
            cursor = conn.execute(
                """
                UPDATE session_runs
                SET status = ?, finished_at = COALESCE(finished_at, ?),
                    updated_at = ?, error_json = ?
                WHERE id = ? AND status IN ('queued', 'running')
                """,
                (status, ts, ts, error_json, run_id),
            )
            row = conn.execute(
                "SELECT * FROM session_runs WHERE id = ?",
                (run_id,),
            ).fetchone()
            if row is None:
                raise KeyError(run_id)
            # Terminal transitions are idempotent for cleanup and repeated interrupts.
            if cursor.rowcount == 0 and row["status"] != status:
                return row
            if cursor.rowcount == 1:
                stop_reason = (error or {}).get("code") or "completed"
                event_status = {
                    "completed": "succeeded",
                    "failed": "failed",
                    "interrupted": "cancelled",
                }[status]
                events: list[tuple[str, dict]] = []
                clean_partial = (partial_message or "").strip()
                if status == "interrupted" and clean_partial and row["started_at"] is not None:
                    message_id = new_id("msg")
                    action_id = new_id("act")
                    metadata = {
                        "interrupted": True,
                        "interrupted_run_id": run_id,
                        "resume_pending": True,
                        "resume_state": "awaiting_question",
                    }
                    conn.execute(
                        """
                        INSERT INTO messages (
                          id, session_id, role, content, action_id, action,
                          in_reply_to_action_id, metadata_json, created_at
                        ) VALUES (?, ?, 'assistant', ?, ?, 'INTERRUPTED_EXPLANATION',
                                  NULL, ?, ?)
                        """,
                        (
                            message_id,
                            row["session_id"],
                            clean_partial,
                            action_id,
                            json.dumps(metadata, ensure_ascii=False),
                            ts,
                        ),
                    )
                    events.append(
                        (
                            "message.completed",
                            {
                                "run_id": run_id,
                                "message_id": message_id,
                                "role": "assistant",
                                "content": clean_partial,
                                "action_id": action_id,
                                "action": "INTERRUPTED_EXPLANATION",
                                "in_reply_to_action_id": None,
                                "interrupted": True,
                            },
                        )
                    )
                if error is not None:
                    events.append(
                        (
                            "error.occurred",
                            {
                                "run_id": run_id,
                                "code": error.get("code", status),
                                "message": error.get("message", status),
                                "error_type": error.get("type"),
                                "retryable": bool(error.get("retryable", False)),
                            },
                        )
                    )
                events.extend(
                    [
                        (
                            "run.completed",
                            {
                                "run_id": run_id,
                                "status": event_status,
                                "stop_reason": stop_reason,
                                "action_count": max(
                                    0,
                                    int(row["last_committed_action_index"]) + 1,
                                ),
                            },
                        ),
                        ("session.idle", {"run_id": run_id, "reason": stop_reason}),
                    ]
                )
                self.events.append_in_transaction(conn, row["session_id"], events)
        return self.get_run(run_id)

    def recover_orphaned_runs(self) -> list[sqlite3.Row]:
        """Fail work left active by a previous process; provider calls are never resumed."""
        ts = now_iso()
        recovered_ids: list[str] = []
        with self.db.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            rows = conn.execute(
                """
                SELECT id, session_id, status, last_committed_action_index
                FROM session_runs
                WHERE status IN ('queued', 'running')
                ORDER BY queued_at ASC
                """
            ).fetchall()
            for row in rows:
                error = {
                    "code": "process_restarted",
                    "message": "服务进程重启，未完成的生成不会自动恢复，以避免重复调用模型。",
                    "type": "RunRecoveryError",
                    "retryable": True,
                    "previous_status": row["status"],
                }
                conn.execute(
                    """
                    UPDATE session_runs
                    SET status = 'failed', finished_at = ?, updated_at = ?, error_json = ?
                    WHERE id = ? AND status IN ('queued', 'running')
                    """,
                    (ts, ts, json.dumps(error, ensure_ascii=False), row["id"]),
                )
                self.events.append_in_transaction(
                    conn,
                    row["session_id"],
                    [
                        (
                            "error.occurred",
                            {
                                "run_id": row["id"],
                                "code": error["code"],
                                "message": error["message"],
                                "error_type": error["type"],
                                "retryable": error["retryable"],
                            },
                        ),
                        (
                            "run.completed",
                            {
                                "run_id": row["id"],
                                "status": "failed",
                                "stop_reason": error["code"],
                                "action_count": max(
                                    0,
                                    int(row["last_committed_action_index"]) + 1,
                                ),
                            },
                        ),
                        (
                            "session.idle",
                            {"run_id": row["id"], "reason": error["code"]},
                        ),
                    ],
                )
                recovered_ids.append(row["id"])
        return [self.get_run(run_id) for run_id in recovered_ids]
