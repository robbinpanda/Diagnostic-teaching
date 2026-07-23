"""Add hierarchical folders for archived study cards.

Revision ID: 0006_card_folders
Revises: 0005_conversational_context
Create Date: 2026-07-21
"""

from __future__ import annotations

from alembic import op


revision = "0006_card_folders"
down_revision = "0005_conversational_context"
branch_labels = None
depends_on = None


DEFAULT_KNOWLEDGE_FOLDER_ID = "folder_default_knowledge"
DEFAULT_PROBLEM_FOLDER_ID = "folder_default_problem"


def upgrade() -> None:
    bind = op.get_bind()
    bind.exec_driver_sql(
        """
        CREATE TABLE card_folders (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL CHECK (LENGTH(TRIM(name)) BETWEEN 1 AND 80),
          parent_id TEXT,
          is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
          default_card_type TEXT UNIQUE
            CHECK (default_card_type IS NULL OR default_card_type IN ('knowledge_card', 'problem_card')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (parent_id) REFERENCES card_folders(id)
            ON UPDATE CASCADE ON DELETE RESTRICT,
          CHECK (parent_id IS NULL OR parent_id <> id)
        )
        """
    )
    bind.exec_driver_sql(
        """
        CREATE UNIQUE INDEX uq_card_folders_root_name
        ON card_folders(name COLLATE NOCASE)
        WHERE parent_id IS NULL
        """
    )
    bind.exec_driver_sql(
        """
        CREATE UNIQUE INDEX uq_card_folders_child_name
        ON card_folders(parent_id, name COLLATE NOCASE)
        WHERE parent_id IS NOT NULL
        """
    )
    bind.exec_driver_sql(
        "CREATE INDEX idx_card_folders_parent ON card_folders(parent_id, name COLLATE NOCASE)"
    )
    bind.exec_driver_sql(
        f"""
        INSERT INTO card_folders (
          id, name, parent_id, is_system, default_card_type, created_at, updated_at
        ) VALUES
          ('{DEFAULT_KNOWLEDGE_FOLDER_ID}', '默认知识卡片', NULL, 1, 'knowledge_card', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
          ('{DEFAULT_PROBLEM_FOLDER_ID}', '默认题目卡片', NULL, 1, 'problem_card', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        """
    )
    bind.exec_driver_sql(
        """
        ALTER TABLE study_cards
        ADD COLUMN folder_id TEXT REFERENCES card_folders(id)
          ON UPDATE CASCADE ON DELETE RESTRICT
        """
    )
    bind.exec_driver_sql(
        f"""
        UPDATE study_cards
        SET folder_id = CASE card_type
          WHEN 'knowledge_card' THEN '{DEFAULT_KNOWLEDGE_FOLDER_ID}'
          ELSE '{DEFAULT_PROBLEM_FOLDER_ID}'
        END
        """
    )
    bind.exec_driver_sql(
        "CREATE INDEX idx_study_cards_folder_saved ON study_cards(folder_id, saved_at, created_at DESC)"
    )


def downgrade() -> None:
    op.drop_index("idx_study_cards_folder_saved", table_name="study_cards")
    op.drop_column("study_cards", "folder_id")
    op.drop_index("idx_card_folders_parent", table_name="card_folders")
    op.drop_index("uq_card_folders_child_name", table_name="card_folders")
    op.drop_index("uq_card_folders_root_name", table_name="card_folders")
    op.drop_table("card_folders")
