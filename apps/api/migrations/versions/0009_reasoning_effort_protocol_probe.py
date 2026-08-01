"""Use protocol-level reasoning effort with per-profile probed options.

Revision ID: 0009_reasoning_effort_protocol_probe
Revises: 0008_reasoning_effort_levels
Create Date: 2026-07-30
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0009_reasoning_effort_protocol_probe"
down_revision = "0008_reasoning_effort_levels"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "model_profiles",
        sa.Column(
            "reasoning_effort_options_json",
            sa.Text(),
            nullable=False,
            server_default='["none","low","high"]',
        ),
    )
    op.execute(
        "UPDATE model_profiles SET reasoning_effort = 'none' "
        "WHERE reasoning_effort = 'minimal'"
    )
    op.execute(
        "UPDATE model_profiles SET reasoning_effort = 'low' "
        "WHERE reasoning_effort IN ('auto', 'medium') "
        "OR reasoning_effort NOT IN ('none', 'low', 'high')"
    )
    with op.batch_alter_table("model_profiles") as batch_op:
        batch_op.alter_column(
            "reasoning_effort",
            existing_type=sa.Text(),
            existing_nullable=False,
            server_default="low",
        )


def downgrade() -> None:
    op.execute(
        "UPDATE model_profiles SET reasoning_effort = 'minimal' "
        "WHERE reasoning_effort = 'none'"
    )
    with op.batch_alter_table("model_profiles") as batch_op:
        batch_op.alter_column(
            "reasoning_effort",
            existing_type=sa.Text(),
            existing_nullable=False,
            server_default="medium",
        )
    op.drop_column("model_profiles", "reasoning_effort_options_json")
