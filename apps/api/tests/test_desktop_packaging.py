from pathlib import Path

from fastapi.testclient import TestClient

from app.core.config import load_settings
from app.desktop import create_desktop_app


def configure_desktop_environment(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'desktop.db'}")
    monkeypatch.setenv("APP_SECRET_PATH", str(tmp_path / "desktop.key"))
    monkeypatch.setenv("SESSION_LOG_DIR", str(tmp_path / "logs"))
    monkeypatch.setenv("OPENCODE_CATALOG_REFRESH_ENABLED", "0")


def test_desktop_settings_disable_catalog_network(monkeypatch, tmp_path: Path):
    configure_desktop_environment(monkeypatch, tmp_path)

    assert load_settings().opencode_catalog_refresh_enabled is False


def test_desktop_bundle_installs_encrypted_seed_only_for_fresh_users():
    root = Path(__file__).resolve().parents[2]
    main_source = (root / "desktop" / "src" / "main.cjs").read_text(encoding="utf-8")
    builder_config = (root / "desktop" / "electron-builder.yml").read_text(encoding="utf-8")

    assert "installBundledModelSeed(dataDirectory)" in main_source
    assert "existsSync(databasePath) || existsSync(secretPath)" in main_source
    assert "copyFileSync(seedDatabasePath, databasePath)" in main_source
    assert "copyFileSync(seedSecretPath, secretPath)" in main_source
    assert "rmSync(databasePath, { force: true })" in main_source
    assert "from: ../../dist/windows/seed" in builder_config


def test_catalog_network_refresh_defaults_on_for_development(monkeypatch, tmp_path: Path):
    configure_desktop_environment(monkeypatch, tmp_path)
    monkeypatch.delenv("OPENCODE_CATALOG_REFRESH_ENABLED")
    assert load_settings().opencode_catalog_refresh_enabled is True

    monkeypatch.setenv("OPENCODE_CATALOG_REFRESH_ENABLED", "0")
    assert load_settings().opencode_catalog_refresh_enabled is False


def test_desktop_app_serves_export_and_security_headers(monkeypatch, tmp_path: Path):
    configure_desktop_environment(monkeypatch, tmp_path)
    web_root = tmp_path / "web"
    web_root.mkdir()
    (web_root / "index.html").write_text("<html><body>desktop-ready</body></html>", encoding="utf-8")

    with TestClient(create_desktop_app(web_root)) as client:
        health = client.get("/api/health")
        page = client.get("/")
        shutdown = client.post("/api/desktop/shutdown")

    assert health.json() == {"ok": True}
    assert page.status_code == 200
    assert "desktop-ready" in page.text
    assert page.headers["content-security-policy"].startswith("default-src 'self'")
    assert page.headers["x-content-type-options"] == "nosniff"
    assert shutdown.status_code == 404
