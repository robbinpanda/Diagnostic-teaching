"""Merge reasoning-effort and conversation-workflow migration heads.

Revision ID: 0010_merge_feature_heads
Revises: 0008_nonblocking_cards, 0009_reasoning_effort_protocol_probe
"""

revision = "0010_merge_feature_heads"
down_revision = ("0008_nonblocking_cards", "0009_reasoning_effort_protocol_probe")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
