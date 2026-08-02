from pathlib import Path


def test_default_docker_image_is_lightweight_and_persistent():
    root = Path(__file__).resolve().parents[3]
    dockerfile = (root / "Dockerfile").read_text(encoding="utf-8")
    compose = (root / "compose.local.yml").read_text(encoding="utf-8")

    assert "image: diagnostic-teaching:0.5.0" in compose
    assert "./runtime/data:/workspace/data" in compose
    assert "./runtime/logs:/workspace/logs" in compose
    assert "COPY apps/api/requirements-core.txt ./" in dockerfile
    assert 'ARG INSTALL_SPEECH=0' in dockerfile
    assert 'if [ "$INSTALL_SPEECH" = "1" ]' in dockerfile
    assert "USER tutor" in dockerfile
    assert "HEALTHCHECK" in dockerfile


def test_optional_speech_image_uses_matching_cpu_only_pytorch_wheels():
    root = Path(__file__).resolve().parents[3]
    dockerfile = (root / "Dockerfile").read_text(encoding="utf-8")
    speech_compose = (root / "compose.speech.yml").read_text(encoding="utf-8")
    speech_requirements = (
        root / "apps" / "api" / "requirements-speech.txt"
    ).read_text(encoding="utf-8")

    assert "INSTALL_SPEECH: \"1\"" in speech_compose
    assert "diagnostic-teaching:0.5.0-speech" in speech_compose
    assert "--index-url https://download.pytorch.org/whl/cpu" in dockerfile
    assert "torch==2.11.0+cpu torchaudio==2.11.0+cpu" in dockerfile
    assert "torch==2.11.0" in speech_requirements
    assert "torchaudio==2.11.0" in speech_requirements


def test_shared_static_server_host_is_configurable_for_containers():
    root = Path(__file__).resolve().parents[2]
    entrypoint = (root / "api" / "desktop_main.py").read_text(encoding="utf-8")

    assert 'os.environ.get("DIAGNOSTIC_TEACHING_HOST", "127.0.0.1")' in entrypoint
    assert "host=host" in entrypoint
