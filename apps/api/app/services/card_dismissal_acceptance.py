from __future__ import annotations

from app.services.input_acceptance_models import (
    CARD_DISMISSED_CONTINUE,
    AcceptedSessionInput,
    InputStateConflictError,
    InputValidationError,
)
from app.services.input_acceptance_models import (
    canonical_json as _canonical_json,
)
from app.services.input_acceptance_models import (
    load_json as _load_json,
)
from app.storage.repository_utils import new_id, now_iso


class CardDismissalAcceptanceMixin:
    def accept_card_dismissed_continue(
        self,
        session_id: str,
        *,
        client_command_id: str,
        card_id: str,
        content: dict | None = None,
        save_to_library: bool = True,
    ) -> AcceptedSessionInput:
        key = client_command_id.strip()
        if not key:
            raise InputValidationError("client_command_id 不能为空")
        if not save_to_library and content is not None:
            raise InputValidationError("舍弃知识卡片时不能同时提交卡片内容")
        durable_payload = {"card_id": card_id}
        if content is not None:
            durable_payload["content"] = content
        if not save_to_library:
            durable_payload["save_to_library"] = False
        payload_json = _canonical_json(durable_payload)

        with self.db.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            if conn.execute("SELECT 1 FROM sessions WHERE id = ?", (session_id,)).fetchone() is None:
                raise KeyError(session_id)
            existing = self._existing_by_key(conn, session_id, key)
            if existing is not None:
                self._assert_same_input(
                    existing,
                    kind=CARD_DISMISSED_CONTINUE,
                    payload_json=payload_json,
                )
                card_row = conn.execute(
                    "SELECT * FROM study_cards WHERE id = ?",
                    (existing["card_id"],),
                ).fetchone()
                return AcceptedSessionInput(
                    input_row=existing,
                    accepted=False,
                    result=_load_json(existing["result_json"]),
                    card_row=card_row,
                )

            prior_card_input = conn.execute(
                "SELECT * FROM session_inputs WHERE card_id = ?",
                (card_id,),
            ).fetchone()
            if prior_card_input is not None:
                raise InputStateConflictError(card_id)
            card_row = conn.execute(
                "SELECT * FROM study_cards WHERE id = ?",
                (card_id,),
            ).fetchone()
            if card_row is None:
                raise KeyError(card_id)
            if card_row["session_id"] != session_id:
                raise PermissionError(card_id)
            if card_row["card_type"] != "knowledge_card":
                raise InputValidationError("只有知识卡片关闭后需要继续生成")
            if not save_to_library and card_row["saved_at"] is not None:
                raise InputStateConflictError(card_id)
            if content is not None and card_row["saved_at"] is not None:
                stored_content = _load_json(card_row["content_json"])
                if _canonical_json(stored_content) != _canonical_json(content):
                    raise InputStateConflictError(card_id)

            input_id = new_id("inp")
            ts = card_row["saved_at"] or now_iso()
            newly_saved = save_to_library and card_row["saved_at"] is None
            if newly_saved:
                if content is None:
                    conn.execute(
                        "UPDATE study_cards SET saved_at = ? WHERE id = ?",
                        (ts, card_id),
                    )
                else:
                    conn.execute(
                        """
                        UPDATE study_cards
                        SET title = ?, content_json = ?, saved_at = ?
                        WHERE id = ?
                        """,
                        (content["title"], _canonical_json(content), ts, card_id),
                    )
            result = {
                "card_id": card_id,
                "card_saved_at": ts if save_to_library else None,
                "card_discarded": not save_to_library,
            }
            conn.execute(
                """
                INSERT INTO session_inputs (
                  id, session_id, kind, idempotency_key, payload_json,
                  result_json, card_id, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    input_id,
                    session_id,
                    CARD_DISMISSED_CONTINUE,
                    key,
                    payload_json,
                    _canonical_json(result),
                    card_id,
                    ts,
                ),
            )
            conn.execute(
                "UPDATE sessions SET updated_at = ? WHERE id = ?",
                (ts, session_id),
            )
            if newly_saved:
                self.sessions.events.append_in_transaction(
                    conn,
                    session_id,
                    [
                        (
                            "card.saved",
                            {
                                "input_id": input_id,
                                "card_id": card_id,
                                "card_type": card_row["card_type"],
                                "source_action_id": card_row["source_action_id"],
                                "source_message_id": card_row["source_message_id"],
                                "saved_at": ts,
                            },
                        )
                    ],
                )
            elif not save_to_library:
                self.sessions.events.append_in_transaction(
                    conn,
                    session_id,
                    [
                        (
                            "card.discarded",
                            {
                                "input_id": input_id,
                                "card_id": card_id,
                                "card_type": card_row["card_type"],
                                "source_action_id": card_row["source_action_id"],
                                "source_message_id": card_row["source_message_id"],
                                "discarded_at": ts,
                            },
                        )
                    ],
                )
                conn.execute("DELETE FROM study_cards WHERE id = ?", (card_id,))
            input_row = conn.execute(
                "SELECT * FROM session_inputs WHERE id = ?",
                (input_id,),
            ).fetchone()
            card_row = None if not save_to_library else conn.execute(
                "SELECT * FROM study_cards WHERE id = ?",
                (card_id,),
            ).fetchone()
        return AcceptedSessionInput(
            input_row=input_row,
            accepted=True,
            result=result,
            card_row=card_row,
        )
