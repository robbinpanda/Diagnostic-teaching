"""Snapshot problem-card content in mistake-set items.

Revision ID: 0015_mistake_set_problem_cards
Revises: 0014_mistake_sets
Create Date: 2026-08-07
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0015_mistake_set_problem_cards"
down_revision = "0014_mistake_sets"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "mistake_set_items",
        sa.Column("problem_card_json", sa.Text(), nullable=True),
    )
    bind = op.get_bind()
    bind.exec_driver_sql(
        """
        UPDATE mistake_set_items
        SET problem_card_json = (
          SELECT c.content_json
          FROM study_cards c
          WHERE c.session_id = mistake_set_items.source_session_id
            AND c.card_type = 'problem_card'
          ORDER BY c.created_at DESC, c.rowid DESC
          LIMIT 1
        )
        WHERE source_session_id IS NOT NULL
        """
    )


def downgrade() -> None:
    op.drop_column("mistake_set_items", "problem_card_json")
