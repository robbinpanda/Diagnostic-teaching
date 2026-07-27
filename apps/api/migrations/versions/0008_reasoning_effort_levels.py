"""Replace legacy auto effort with the explicit medium default tier.

Revision ID: 0008_reasoning_effort_levels
Revises: 0007_reasoning_effort
Create Date: 2026-07-27
"""

from __future__ import annotations

from alembic import op


revision = "0008_reasoning_effort_levels"
down_revision = "0007_reasoning_effort"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "UPDATE model_profiles SET reasoning_effort = 'medium' "
        "WHERE reasoning_effort = 'auto'"
    )


def downgrade() -> None:
    # `medium` already existed in the previous API. Only the newly introduced
    # `minimal` value needs coercion for an older application version.
    op.execute(
        "UPDATE model_profiles SET reasoning_effort = 'low' "
        "WHERE reasoning_effort = 'minimal'"
    )
