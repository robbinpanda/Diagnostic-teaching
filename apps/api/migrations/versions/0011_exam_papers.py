"""Group tutoring sessions by exam paper.

Revision ID: 0011_exam_papers
Revises: 0010_merge_feature_heads
Create Date: 2026-08-05
"""

from __future__ import annotations

from alembic import op


revision = "0011_exam_papers"
down_revision = "0010_merge_feature_heads"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    bind.exec_driver_sql(
        """
        CREATE TABLE exam_papers (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL CHECK (LENGTH(TRIM(name)) BETWEEN 1 AND 80),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
        """
    )
    bind.exec_driver_sql(
        "CREATE UNIQUE INDEX uq_exam_papers_name ON exam_papers(name COLLATE NOCASE)"
    )
    bind.exec_driver_sql(
        "ALTER TABLE sessions ADD COLUMN paper_id TEXT REFERENCES exam_papers(id) ON DELETE SET NULL"
    )
    bind.exec_driver_sql("CREATE INDEX idx_sessions_paper_updated ON sessions(paper_id, updated_at DESC)")


def downgrade() -> None:
    op.drop_index("idx_sessions_paper_updated", table_name="sessions")
    op.drop_column("sessions", "paper_id")
    op.drop_index("uq_exam_papers_name", table_name="exam_papers")
    op.drop_table("exam_papers")
