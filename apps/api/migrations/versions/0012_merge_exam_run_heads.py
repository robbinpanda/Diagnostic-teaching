"""Merge exam-paper and client-run migration heads.

Revision ID: 0012_merge_exam_run_heads
Revises: 0011_exam_papers, 0011_client_run_id
Create Date: 2026-08-06
"""

from __future__ import annotations


revision = "0012_merge_exam_run_heads"
down_revision = ("0011_exam_papers", "0011_client_run_id")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
