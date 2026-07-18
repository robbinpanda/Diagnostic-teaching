# Database migrations

`versions/` is the only place for schema evolution. The API runs `alembic upgrade
head` automatically when `Database` starts, while the Alembic CLI uses the same
`DATABASE_URL` resolution as the application.

Add future tables or columns in a new revision; do not add runtime `ALTER TABLE`
or `_ensure_column` helpers back to `database.py`.
