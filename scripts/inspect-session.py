from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "data" / "app.db"
LOG_DIR = ROOT / "logs" / "sessions"


def print_json(title: str, rows: list[sqlite3.Row]) -> None:
    print(f"\n===== {title} =====")
    if not rows:
        print("(empty)")
        return
    for idx, row in enumerate(rows, start=1):
        print(f"\n--- {title} #{idx} ---")
        print(json.dumps(dict(row), ensure_ascii=False, indent=2))


def short(text: str, limit: int = 260) -> str:
    text = text.replace("\r\n", "\n").strip()
    return text if len(text) <= limit else text[:limit] + "..."


def timeline(conn: sqlite3.Connection, session_id: str) -> None:
    print("\n===== TIMELINE =====")
    message_rows = conn.execute(
        """
        SELECT created_at AS ts, role AS kind, content AS body,
               json_object(
                 'message_id', id,
                 'action_id', action_id,
                 'action', action,
                 'in_reply_to_action_id', in_reply_to_action_id,
                 'metadata_json', metadata_json
               ) AS extra
        FROM messages
        WHERE session_id = ?
        ORDER BY created_at
        """,
        (session_id,),
    ).fetchall()
    checkpoint_rows = conn.execute(
        """
        SELECT created_at AS ts, 'checkpoint_created' AS kind, question AS body,
               json_object(
                 'id', id,
                 'source_action_id', source_action_id,
                 'correct_option_id', correct_option_id,
                 'selected_option_id', selected_option_id,
                 'is_correct', is_correct,
                 'answered_at', answered_at
               ) AS extra
        FROM checkpoints
        WHERE session_id = ?
        ORDER BY created_at
        """,
        (session_id,),
    ).fetchall()
    card_rows = conn.execute(
        """
        SELECT created_at AS ts, card_type AS kind, title AS body,
               json_object(
                 'id', id,
                 'source_action_id', source_action_id,
                 'source_message_id', source_message_id,
                 'saved_at', saved_at
               ) AS extra
        FROM study_cards
        WHERE session_id = ?
        ORDER BY created_at
        """,
        (session_id,),
    ).fetchall()
    rows = sorted([*message_rows, *checkpoint_rows, *card_rows], key=lambda row: row["ts"])
    if not rows:
        print("(empty)")
        return
    for row in rows:
        print(f"\n[{row['ts']}] {row['kind']}")
        print(short(row["body"], 600))
        if row["extra"] and row["extra"] != "{}":
            print("extra:", short(row["extra"], 600))


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    session_id = sys.argv[1] if len(sys.argv) > 1 else None
    if not DB_PATH.exists():
        print(f"DB not found: {DB_PATH}")
        return 1
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    if not session_id:
        rows = conn.execute(
            """
            SELECT id, phase, model_profile_id, substr(problem_text, 1, 80) AS problem_preview,
                   created_at, updated_at
            FROM sessions
            ORDER BY created_at DESC
            LIMIT 10
            """
        ).fetchall()
        print_json("LATEST SESSIONS", rows)
        print("\nUsage:")
        print("  python scripts/inspect-session.py <session_id>")
        return 0

    sessions = conn.execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchall()
    print_json("SESSION", sessions)
    readable_log = LOG_DIR / f"{session_id}.log.md"
    jsonl_log = LOG_DIR / f"{session_id}.jsonl"
    print("\n===== LOG FILES =====")
    print(f"Human-readable: {readable_log}{'' if readable_log.exists() else ' (not found)'}")
    print(f"Machine JSONL:  {jsonl_log}{'' if jsonl_log.exists() else ' (not found)'}")
    timeline(conn, session_id)
    messages = conn.execute(
        """
        SELECT id, role, action_id, action, in_reply_to_action_id,
               content, metadata_json, created_at
        FROM messages
        WHERE session_id = ?
        ORDER BY created_at
        """,
        (session_id,),
    ).fetchall()
    print_json("MESSAGES RAW", messages)
    checkpoints = conn.execute(
        """
        SELECT id, source_action_id, question, options_json, correct_option_id, selected_option_id,
               is_correct, elapsed_ms, created_at, answered_at
        FROM checkpoints
        WHERE session_id = ?
        ORDER BY created_at
        """,
        (session_id,),
    ).fetchall()
    print_json("CHECKPOINTS RAW", checkpoints)
    cards = conn.execute(
        """
        SELECT id, card_type, title, content_json, source_action_id,
               source_message_id, created_at, saved_at
        FROM study_cards
        WHERE session_id = ?
        ORDER BY created_at
        """,
        (session_id,),
    ).fetchall()
    print_json("STUDY CARDS RAW", cards)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
