"""Allow a pending study card to be deferred while conversation continues.

Revision ID: 0008_nonblocking_cards
Revises: 0007_checkpoint_free_text
Create Date: 2026-08-01
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0008_nonblocking_cards"
down_revision = "0007_checkpoint_free_text"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("study_cards", sa.Column("deferred_at", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("study_cards", "deferred_at")
