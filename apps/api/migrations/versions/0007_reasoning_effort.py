"""Add a persistent per-profile reasoning effort preference.

Revision ID: 0007_reasoning_effort
Revises: 0006_card_folders
Create Date: 2026-07-27
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0007_reasoning_effort"
down_revision = "0006_card_folders"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "model_profiles",
        sa.Column(
            "reasoning_effort",
            sa.Text(),
            nullable=False,
            server_default="medium",
        ),
    )


def downgrade() -> None:
    op.drop_column("model_profiles", "reasoning_effort")
