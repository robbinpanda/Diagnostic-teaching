from __future__ import annotations

import json
import sqlite3

from app.core.schemas import TutorTurn
from app.storage.card_folder_repository import default_folder_id
from app.storage.database import Database
from app.storage.repository_utils import new_id, now_iso
from app.storage.run_state import RunStateConflict
from app.storage.session_events import SessionEventRepository


def record_tutor_action(
    db: Database,
    events: SessionEventRepository,
    session_id: str,
    turn: TutorTurn,
    *,
    action_index: int,
    run_id: str | None = None,
) -> tuple[sqlite3.Row, sqlite3.Row | None, sqlite3.Row | None]:
    """Atomically save session state, assistant action, checkpoint, and pending card."""
    message_id = new_id("msg")
    action_id = new_id("act")
    checkpoint_id = new_id("chk") if turn.checkpoint else None
    card_content = turn.knowledge_card or turn.problem_card
    card_id = new_id("card") if card_content else None
    ts = now_iso()
    metadata = {
        "state_hint": turn.state_hint,
        "context_status": turn.context_status,
        "problem_summary": turn.problem_summary,
        "student_thought_summary": turn.student_thought_summary,
        "action": turn.action,
        "wait_for_student": turn.wait_for_student,
        "breakpoint": turn.breakpoint_description,
        "action_index": action_index,
        "checkpoint_id": checkpoint_id,
        "checkpoint": turn.checkpoint.model_dump() if turn.checkpoint else None,
        "card_id": card_id,
        "knowledge_card": turn.knowledge_card.model_dump() if turn.knowledge_card else None,
        "problem_card": turn.problem_card.model_dump() if turn.problem_card else None,
    }

    with db.connect() as conn:
        # Serialize explicit interruption against the complete action commit.
        # Whichever obtains the write lock first wins: an already committed full
        # action is preserved; an interrupted run cannot commit a partial step.
        if run_id is not None:
            guard = conn.execute(
                """
                UPDATE session_runs
                SET updated_at = updated_at
                WHERE id = ? AND session_id = ? AND status = 'running'
                """,
                (run_id, session_id),
            )
            run_row = conn.execute(
                "SELECT status, session_id FROM session_runs WHERE id = ?",
                (run_id,),
            ).fetchone()
            if run_row is None:
                raise KeyError(run_id)
            if run_row["session_id"] != session_id:
                raise PermissionError(run_id)
            if guard.rowcount == 0 or run_row["status"] != "running":
                raise RunStateConflict(run_id, run_row["status"])
        cursor = conn.execute(
            """
            UPDATE sessions
            SET phase = ?, breakpoint_description = ?,
                breakpoint_confidence = ?, context_status = ?,
                problem_text = CASE
                  WHEN ? IS NULL OR TRIM(?) = '' THEN problem_text ELSE ?
                END,
                student_initial_thought = CASE
                  WHEN ? IS NULL OR TRIM(?) = '' THEN student_initial_thought ELSE ?
                END,
                updated_at = ?
            WHERE id = ?
            """,
            (
                turn.state_hint,
                turn.breakpoint_description,
                turn.breakpoint_confidence,
                turn.context_status,
                turn.problem_summary,
                turn.problem_summary,
                turn.problem_summary,
                turn.student_thought_summary,
                turn.student_thought_summary,
                turn.student_thought_summary,
                ts,
                session_id,
            ),
        )
        if cursor.rowcount == 0:
            raise KeyError(session_id)

        conn.execute(
            """
            INSERT INTO messages (
              id, session_id, role, content, action_id, action,
              in_reply_to_action_id, metadata_json, created_at
            ) VALUES (?, ?, 'assistant', ?, ?, ?, NULL, ?, ?)
            """,
            (
                message_id,
                session_id,
                turn.message,
                action_id,
                turn.action,
                json.dumps(metadata, ensure_ascii=False),
                ts,
            ),
        )

        checkpoint_row = None
        if turn.checkpoint and checkpoint_id:
            correct = [option for option in turn.checkpoint.options if option.is_correct]
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
                    turn.checkpoint.question,
                    turn.checkpoint.model_dump_json(),
                    correct[0].id,
                    turn.checkpoint.tested_point,
                    action_id,
                    ts,
                ),
            )
            checkpoint_row = conn.execute(
                "SELECT * FROM checkpoints WHERE id = ?",
                (checkpoint_id,),
            ).fetchone()

        card_row = None
        if card_content and card_id:
            conn.execute(
                """
                INSERT INTO study_cards (
                  id, session_id, live_session_id, card_type, title, content_json,
                  source_action_id, source_message_id, created_at, saved_at, folder_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
                """,
                (
                    card_id,
                    session_id,
                    session_id,
                    card_content.type,
                    card_content.title,
                    card_content.model_dump_json(),
                    action_id,
                    message_id,
                    ts,
                    default_folder_id(card_content.type),
                ),
            )
            card_row = conn.execute(
                "SELECT * FROM study_cards WHERE id = ?",
                (card_id,),
            ).fetchone()

        assistant_row = conn.execute(
            "SELECT * FROM messages WHERE id = ?",
            (message_id,),
        ).fetchone()
        if run_id is not None:
            conn.execute(
                """
                UPDATE session_runs
                SET last_committed_action_index = ?, updated_at = ?
                WHERE id = ? AND status = 'running'
                """,
                (action_index, ts, run_id),
            )

        durable_events: list[tuple[str, dict]] = [
            (
                "message.completed",
                {
                    "run_id": run_id,
                    "message_id": message_id,
                    "role": "assistant",
                    "content": turn.message,
                    "action_id": action_id,
                    "action": turn.action,
                    "in_reply_to_action_id": None,
                },
            ),
            (
                "action.completed",
                {
                    "run_id": run_id,
                    "action_index": action_index,
                    "action_id": action_id,
                    "message_id": message_id,
                    "action": turn.action,
                    "state_hint": turn.state_hint,
                    "context_status": turn.context_status,
                    "wait_for_student": turn.wait_for_student,
                    "message": turn.message,
                    "breakpoint": turn.breakpoint_description,
                    "confidence": turn.breakpoint_confidence,
                    "checkpoint_id": checkpoint_id,
                    "card_id": card_id,
                },
            ),
        ]
        if turn.checkpoint and checkpoint_id:
            checkpoint_data = turn.checkpoint.model_dump()
            for option in checkpoint_data["options"]:
                option.pop("is_correct", None)
                option.pop("misconception", None)
            durable_events.append(
                (
                    "checkpoint.ready",
                    {
                        "run_id": run_id,
                        "checkpoint_id": checkpoint_id,
                        "source_action_id": action_id,
                        "checkpoint": checkpoint_data,
                    },
                )
            )
        if card_content and card_id:
            durable_events.append(
                (
                    "card.ready",
                    {
                        "run_id": run_id,
                        "card_id": card_id,
                        "card_type": card_content.type,
                        "source_action_id": action_id,
                        "source_message_id": message_id,
                        "folder_id": default_folder_id(card_content.type),
                        "content": card_content.model_dump(),
                    },
                )
            )
        events.append_in_transaction(conn, session_id, durable_events)

    return assistant_row, checkpoint_row, card_row
