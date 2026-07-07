from __future__ import annotations

from pathlib import Path

from cryptography.fernet import Fernet


class SecretBox:
    def __init__(self, secret_path: Path):
        self.secret_path = secret_path
        self.secret_path.parent.mkdir(parents=True, exist_ok=True)
        if self.secret_path.exists():
            key = self.secret_path.read_bytes()
        else:
            key = Fernet.generate_key()
            self.secret_path.write_bytes(key)
        self._fernet = Fernet(key)

    def encrypt(self, value: str) -> str:
        return self._fernet.encrypt(value.encode("utf-8")).decode("utf-8")

    def decrypt(self, value: str) -> str:
        return self._fernet.decrypt(value.encode("utf-8")).decode("utf-8")


def mask_api_key(value: str) -> str:
    if len(value) <= 8:
        return "****"
    prefix = value[:3] if value.startswith("sk-") else "****"
    return f"{prefix}...{value[-4:]}"
