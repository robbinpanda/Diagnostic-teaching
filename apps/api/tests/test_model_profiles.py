from pathlib import Path

from app.core.schemas import ModelProfileCreate
from app.storage.database import Database
from app.storage.repositories import ModelProfileRepository, host_from_url
from app.storage.security import SecretBox


def test_model_profile_encrypts_api_key(tmp_path: Path):
    db = Database(tmp_path / "app.db")
    repo = ModelProfileRepository(db, SecretBox(tmp_path / "secret.key"))

    row = repo.create(
        ModelProfileCreate(
            display_name="Test Model",
            provider="openai_compatible",
            base_url="https://example.com/v1",
            api_key="sk-test-secret",
            model="test-model",
            tags=["math"],
        )
    )

    assert row["api_key_ciphertext"] != "sk-test-secret"
    assert row["api_key_mask"].endswith("cret")
    assert repo.decrypt_api_key(row) == "sk-test-secret"
    assert host_from_url(row["base_url"]) == "example.com"
