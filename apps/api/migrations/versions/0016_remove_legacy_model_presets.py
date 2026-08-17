"""Hide model profiles created by removed preset mechanisms.

Revision ID: 0016_remove_legacy_model_presets
Revises: 0015_mistake_set_problem_cards
Create Date: 2026-08-17
"""

from __future__ import annotations

from alembic import op


revision = "0016_remove_legacy_model_presets"
down_revision = "0015_mistake_set_problem_cards"
branch_labels = None
depends_on = None


# Hex-encoded historical internal tags keep removed third-party names out of the
# application while still allowing upgrades to identify and hide old preset rows.
_REMOVED_PRESET_TAG_HEX = (
    "226f70656e636f64656672656522",
    "2262756e646c65642d706572736f6e616c22",
)


def upgrade() -> None:
    bind = op.get_bind()
    predicates = " OR ".join(
        "instr(lower(hex(tags_json)), ?) > 0" for _ in _REMOVED_PRESET_TAG_HEX
    )
    bind.exec_driver_sql(
        f"""
        UPDATE model_profiles
        SET enabled = 0,
            deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP),
            updated_at = CURRENT_TIMESTAMP
        WHERE {predicates}
        """,
        _REMOVED_PRESET_TAG_HEX,
    )


def downgrade() -> None:
    # Restoring removed presets would unexpectedly expose credentials and models.
    pass
