"""Add durable printable mistake-set snapshots.

Revision ID: 0014_mistake_sets
Revises: 0013_paper_archive_folders
Create Date: 2026-08-06
"""

from __future__ import annotations

from alembic import op


revision = "0014_mistake_sets"
down_revision = "0013_paper_archive_folders"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    bind.exec_driver_sql(
        """
        CREATE TABLE mistake_sets (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL CHECK (LENGTH(TRIM(name)) BETWEEN 1 AND 80),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
        """
    )
    bind.exec_driver_sql(
        """
        CREATE TABLE mistake_set_items (
          id TEXT PRIMARY KEY,
          mistake_set_id TEXT NOT NULL,
          source_session_id TEXT,
          source_paper_name TEXT,
          title TEXT NOT NULL,
          problem_text TEXT NOT NULL,
          problem_image_data_url TEXT,
          position INTEGER NOT NULL CHECK (position >= 0),
          created_at TEXT NOT NULL,
          FOREIGN KEY (mistake_set_id) REFERENCES mistake_sets(id)
            ON UPDATE CASCADE ON DELETE CASCADE,
          FOREIGN KEY (source_session_id) REFERENCES sessions(id)
            ON UPDATE CASCADE ON DELETE SET NULL,
          UNIQUE (mistake_set_id, position)
        )
        """
    )
    bind.exec_driver_sql(
        "CREATE INDEX idx_mistake_sets_updated ON mistake_sets(updated_at DESC)"
    )
    bind.exec_driver_sql(
        "CREATE INDEX idx_mistake_set_items_set ON mistake_set_items(mistake_set_id, position)"
    )
    bind.exec_driver_sql(
        "CREATE INDEX idx_mistake_set_items_source ON mistake_set_items(source_session_id)"
    )


def downgrade() -> None:
    op.drop_index("idx_mistake_set_items_source", table_name="mistake_set_items")
    op.drop_index("idx_mistake_set_items_set", table_name="mistake_set_items")
    op.drop_index("idx_mistake_sets_updated", table_name="mistake_sets")
    op.drop_table("mistake_set_items")
    op.drop_table("mistake_sets")
