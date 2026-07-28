import math
import wave
from io import BytesIO
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.main import create_app
from app.services.sensevoice_transcriber import (
    InvalidSpeechAudio,
    VadUpdate,
    inspect_sensevoice_wav,
    pcm16_to_wav,
)


def _pcm_wav(duration_seconds: float = 0.5, sample_rate: int = 16_000) -> bytes:
    frame_count = int(duration_seconds * sample_rate)
    frames = bytearray()
    for index in range(frame_count):
        sample = int(math.sin(2 * math.pi * 440 * index / sample_rate) * 8_000)
        frames.extend(sample.to_bytes(2, byteorder="little", signed=True))
    output = BytesIO()
    with wave.open(output, "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(sample_rate)
        audio.writeframes(frames)
    return output.getvalue()


def _pcm_frames(duration_seconds: float = 0.5, sample_rate: int = 16_000) -> bytes:
    with wave.open(BytesIO(_pcm_wav(duration_seconds, sample_rate)), "rb") as audio:
        return audio.readframes(audio.getnframes())


class _FakeVadSession:
    def __init__(self):
        self.started = False

    def feed(self, pcm_bytes: bytes, *, is_final: bool = False):
        if not self.started:
            self.started = True
            return [VadUpdate(start_ms=0)]
        return []


class _FakeEndingVadSession:
    def __init__(self):
        self.chunk_count = 0

    def feed(self, pcm_bytes: bytes, *, is_final: bool = False):
        self.chunk_count += 1
        if self.chunk_count == 1:
            return [VadUpdate(start_ms=0)]
        return [VadUpdate(end_ms=600)]


class _ThinkingPauseVadSession:
    def __init__(self):
        self.chunk_count = 0

    def feed(self, pcm_bytes: bytes, *, is_final: bool = False):
        self.chunk_count += 1
        updates = {
            1: [VadUpdate(start_ms=0)],
            2: [VadUpdate(end_ms=400)],
            3: [VadUpdate(start_ms=900)],
            4: [VadUpdate(end_ms=1_600)],
        }
        return updates.get(self.chunk_count, [])


class _FakeTranscriber:
    available = True
    loaded = True
    model_name = "iic/SenseVoiceSmall"
    device = "cpu"
    max_audio_seconds = 60
    commit_silence_ms = 2_500

    def create_stream_vad_session(self):
        return _FakeVadSession()

    def transcribe(self, audio_bytes: bytes):
        info = inspect_sensevoice_wav(audio_bytes, self.max_audio_seconds)
        return SimpleNamespace(
            text="设这个未知数为 x。",
            duration_seconds=info.duration_seconds,
            language="zh",
            emotion="neutral",
            event="speech",
        )

    def transcribe_pcm16(self, pcm_bytes: bytes):
        return self.transcribe(pcm16_to_wav(pcm_bytes))


class _FakeEndingTranscriber(_FakeTranscriber):
    def create_stream_vad_session(self):
        return _FakeEndingVadSession()


class _ThinkingPauseTranscriber(_FakeTranscriber):
    def __init__(self):
        self.transcribed_durations: list[float] = []

    def create_stream_vad_session(self):
        return _ThinkingPauseVadSession()

    def transcribe_pcm16(self, pcm_bytes: bytes):
        self.transcribed_durations.append(len(pcm_bytes) / 32_000)
        return super().transcribe_pcm16(pcm_bytes)


def test_inspect_sensevoice_wav_accepts_browser_pcm_format():
    info = inspect_sensevoice_wav(_pcm_wav(), max_audio_seconds=60)

    assert info.sample_rate == 16_000
    assert info.channels == 1
    assert info.sample_width == 2
    assert info.duration_seconds == pytest.approx(0.5)


def test_inspect_sensevoice_wav_rejects_wrong_sample_rate():
    with pytest.raises(InvalidSpeechAudio, match="16 kHz"):
        inspect_sensevoice_wav(_pcm_wav(sample_rate=44_100), max_audio_seconds=60)


def test_speech_transcribe_endpoint_returns_local_transcript():
    app = create_app()
    app.state.speech_transcriber = _FakeTranscriber()
    client = TestClient(app)

    response = client.post(
        "/api/speech/transcribe",
        content=_pcm_wav(),
        headers={"Content-Type": "audio/wav"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "text": "设这个未知数为 x。",
        "duration_seconds": 0.5,
        "language": "zh",
        "emotion": "neutral",
        "event": "speech",
    }


def test_speech_status_reports_local_model_configuration():
    app = create_app()
    app.state.speech_transcriber = _FakeTranscriber()
    client = TestClient(app)

    response = client.get("/api/speech/status")

    assert response.status_code == 200
    assert response.json() == {
        "available": True,
        "loaded": True,
        "model": "iic/SenseVoiceSmall",
        "device": "cpu",
        "max_audio_seconds": 60,
        "commit_silence_ms": 2_500,
    }


def test_speech_transcribe_endpoint_rejects_non_wav_content_type():
    app = create_app()
    app.state.speech_transcriber = _FakeTranscriber()
    client = TestClient(app)

    response = client.post(
        "/api/speech/transcribe",
        content=b"not audio",
        headers={"Content-Type": "audio/webm"},
    )

    assert response.status_code == 415


def test_speech_stream_returns_partial_and_final_transcripts():
    app = create_app()
    app.state.speech_transcriber = _FakeTranscriber()
    client = TestClient(app)

    with client.websocket_connect("/api/speech/stream") as websocket:
        assert websocket.receive_json() == {
            "type": "ready",
            "sample_rate": 16_000,
            "partial_interval_ms": 1_200,
            "commit_silence_ms": 2_500,
        }
        websocket.send_bytes(_pcm_frames(duration_seconds=1.3))
        partial = websocket.receive_json()
        assert partial["type"] == "partial"
        assert partial["text"] == "设这个未知数为 x。"

        websocket.send_text('{"type":"stop"}')
        final = websocket.receive_json()
        assert final["type"] == "final"
        assert final["text"] == "设这个未知数为 x。"
        assert websocket.receive_json() == {"type": "done"}


def test_speech_stream_finalizes_after_the_thinking_pause_window():
    app = create_app()
    app.state.speech_transcriber = _FakeEndingTranscriber()
    client = TestClient(app)

    with client.websocket_connect("/api/speech/stream") as websocket:
        assert websocket.receive_json()["type"] == "ready"
        websocket.send_bytes(_pcm_frames(duration_seconds=0.3))
        websocket.send_bytes(_pcm_frames(duration_seconds=0.3))
        websocket.send_bytes(bytes(int(2.5 * 32_000)))

        final = websocket.receive_json()
        assert final["type"] == "final"
        assert final["text"] == "设这个未知数为 x。"

        websocket.send_text('{"type":"stop"}')
        assert websocket.receive_json() == {"type": "done"}


def test_speech_stream_merges_short_thinking_pauses_before_finalizing():
    app = create_app()
    transcriber = _ThinkingPauseTranscriber()
    app.state.speech_transcriber = transcriber
    client = TestClient(app)

    with client.websocket_connect("/api/speech/stream") as websocket:
        assert websocket.receive_json()["type"] == "ready"
        for _ in range(4):
            websocket.send_bytes(_pcm_frames(duration_seconds=0.4))
        websocket.send_bytes(bytes(int(2.5 * 32_000)))

        final = websocket.receive_json()
        assert final["type"] == "final"
        assert transcriber.transcribed_durations == [pytest.approx(1.6)]

        websocket.send_text('{"type":"stop"}')
        assert websocket.receive_json() == {"type": "done"}


def test_speech_stream_rejects_cross_site_browser_origins():
    app = create_app()
    app.state.speech_transcriber = _FakeTranscriber()
    client = TestClient(app)

    with pytest.raises(WebSocketDisconnect) as exc_info:
        with client.websocket_connect(
            "/api/speech/stream",
            headers={"Origin": "https://example.test"},
        ):
            pass

    assert exc_info.value.code == 1008
