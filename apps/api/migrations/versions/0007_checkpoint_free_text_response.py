"""Allow checkpoints to be completed by a free-text student response.

Revision ID: 0007_checkpoint_free_text
Revises: 0006_card_folders
Create Date: 2026-08-01
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0007_checkpoint_free_text"
down_revision = "0006_card_folders"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("checkpoints", sa.Column("free_text_response", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("checkpoints", "free_text_response")
