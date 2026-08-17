import json
from pathlib import Path

from fastapi.testclient import TestClient

from app.desktop import create_desktop_app


def configure_desktop_environment(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'desktop.db'}")
    monkeypatch.setenv("APP_SECRET_PATH", str(tmp_path / "desktop.key"))
    monkeypatch.setenv("SESSION_LOG_DIR", str(tmp_path / "logs"))


def test_desktop_bundle_contains_only_application_resources():
    root = Path(__file__).resolve().parents[2]
    main_source = (root / "desktop" / "src" / "main.cjs").read_text(encoding="utf-8")
    builder_config = (root / "desktop" / "electron-builder.yml").read_text(encoding="utf-8")
    installer_include = (root / "desktop" / "build" / "installer.nsh").read_text(encoding="utf-8")
    package = json.loads((root / "desktop" / "package.json").read_text(encoding="utf-8"))

    assert package["version"] == "0.6.1"
    assert "appId: cn.ai4edu.diagnostic-teaching" in builder_config
    assert "oneClick: false" in builder_config
    assert "include: build/installer.nsh" in builder_config
    assert "src/data-reset.cjs" in builder_config
    assert 'resetLegacyUserData(app.getPath("userData"))' in main_source
    assert 'permission === "media"' in main_source
    assert "mediaTypes.length === 1" in main_source
    assert 'mediaTypes[0] === "audio"' in main_source
    assert "callback(allowMicrophone)" in main_source
    assert "perMachine: false" in builder_config
    assert "allowToChangeInstallationDirectory: true" in builder_config
    assert "deleteAppDataOnUninstall: false" in builder_config
    assert "to: seed" not in builder_config
    assert 'IfFileExists "$APPDATA\\DiagnosticTeaching\\.data-reset-v0.5.0"' in installer_include
    assert 'RMDir /r "$APPDATA\\DiagnosticTeaching"' in installer_include
    assert 'CreateDirectory "$APPDATA\\DiagnosticTeaching"' in installer_include
    assert 'FileOpen $0 "$APPDATA\\DiagnosticTeaching\\.data-reset-v0.5.0" w' in installer_include
    assert "Abort" in installer_include
    assert 'RMDir /r "$APPDATA"' not in installer_include
    assert 'RMDir /r "$PROFILE"' not in installer_include
    assert 'RMDir /r "$LOCALAPPDATA"' not in installer_include


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
