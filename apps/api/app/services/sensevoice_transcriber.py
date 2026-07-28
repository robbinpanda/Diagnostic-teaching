from __future__ import annotations

import importlib.util
import re
import threading
import wave
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

SENSEVOICE_SAMPLE_RATE = 16_000
SENSEVOICE_CHANNELS = 1
SENSEVOICE_SAMPLE_WIDTH = 2
_SENSEVOICE_TAG = re.compile(r"<\|([^|]+)\|>")
_MODELSCOPE_ALIASES = {
    "fsmn-vad": "iic/speech_fsmn_vad_zh-cn-16k-common-pytorch",
}


class InvalidSpeechAudio(ValueError):
    pass


class SpeechModelUnavailable(RuntimeError):
    pass


@dataclass(frozen=True)
class WavInfo:
    duration_seconds: float
    sample_rate: int
    channels: int
    sample_width: int


@dataclass(frozen=True)
class TranscriptionResult:
    text: str
    duration_seconds: float
    language: str | None
    emotion: str | None
    event: str | None


@dataclass(frozen=True)
class VadUpdate:
    start_ms: int | None = None
    end_ms: int | None = None


def pcm16_to_wav(pcm_bytes: bytes) -> bytes:
    if not pcm_bytes or len(pcm_bytes) % SENSEVOICE_SAMPLE_WIDTH:
        raise InvalidSpeechAudio("录音不是有效的 16 位 PCM 音频")
    output = BytesIO()
    with wave.open(output, "wb") as audio:
        audio.setnchannels(SENSEVOICE_CHANNELS)
        audio.setsampwidth(SENSEVOICE_SAMPLE_WIDTH)
        audio.setframerate(SENSEVOICE_SAMPLE_RATE)
        audio.writeframes(pcm_bytes)
    return output.getvalue()


def inspect_sensevoice_wav(audio_bytes: bytes, max_audio_seconds: int) -> WavInfo:
    if not audio_bytes:
        raise InvalidSpeechAudio("录音内容为空")
    try:
        with wave.open(BytesIO(audio_bytes), "rb") as audio:
            info = WavInfo(
                duration_seconds=audio.getnframes() / audio.getframerate(),
                sample_rate=audio.getframerate(),
                channels=audio.getnchannels(),
                sample_width=audio.getsampwidth(),
            )
            compression = audio.getcomptype()
    except (EOFError, wave.Error, ZeroDivisionError) as exc:
        raise InvalidSpeechAudio("录音不是有效的 WAV 音频") from exc

    if compression != "NONE":
        raise InvalidSpeechAudio("录音必须使用未压缩的 PCM WAV 格式")
    if (
        info.sample_rate != SENSEVOICE_SAMPLE_RATE
        or info.channels != SENSEVOICE_CHANNELS
        or info.sample_width != SENSEVOICE_SAMPLE_WIDTH
    ):
        raise InvalidSpeechAudio("录音必须是 16 kHz、单声道、16 位 PCM WAV")
    if info.duration_seconds < 0.2:
        raise InvalidSpeechAudio("录音太短，请至少说 0.2 秒")
    if info.duration_seconds > max_audio_seconds + 0.05:
        raise InvalidSpeechAudio(f"单次录音不能超过 {max_audio_seconds} 秒")
    return info


def _sensevoice_metadata(raw_text: str) -> tuple[str | None, str | None, str | None]:
    tags = _SENSEVOICE_TAG.findall(raw_text)
    language = next((tag for tag in tags if tag in {"zh", "en", "yue", "ja", "ko"}), None)
    emotion = next(
        (
            tag.lower()
            for tag in tags
            if tag in {"HAPPY", "SAD", "ANGRY", "NEUTRAL", "FEARFUL", "DISGUSTED", "SURPRISED"}
        ),
        None,
    )
    event = next(
        (
            tag.lower()
            for tag in tags
            if tag in {"BGM", "Speech", "Applause", "Laughter", "Cry", "Sneeze", "Breath", "Cough"}
        ),
        None,
    )
    return language, emotion, event


def _cached_model_reference(reference: str) -> str:
    local_path = Path(reference).expanduser()
    if local_path.exists():
        return str(local_path.resolve())

    model_id = _MODELSCOPE_ALIASES.get(reference, reference)
    if "/" not in model_id:
        return reference
    try:
        from modelscope.hub.snapshot_download import snapshot_download

        return snapshot_download(model_id, local_files_only=True)
    except Exception:
        # A cache miss is expected on first use. Keeping the original reference
        # lets FunASR perform its normal download and cache population.
        return reference


class SenseVoiceTranscriber:
    """Lazily loads one local SenseVoiceSmall + FSMN-VAD pipeline per API process."""

    def __init__(
        self,
        *,
        model: str,
        vad_model: str,
        device: str,
        max_audio_seconds: int,
        commit_silence_ms: int,
    ) -> None:
        self.model_name = model
        self.vad_model_name = vad_model
        self.device = device
        self.max_audio_seconds = max_audio_seconds
        self.commit_silence_ms = commit_silence_ms
        self._model: Any | None = None
        self._load_lock = threading.Lock()
        self._inference_lock = threading.Lock()

    @property
    def loaded(self) -> bool:
        return self._model is not None

    @property
    def available(self) -> bool:
        return importlib.util.find_spec("funasr") is not None

    def _load_model(self) -> Any:
        if self._model is not None:
            return self._model
        with self._load_lock:
            if self._model is not None:
                return self._model
            try:
                from funasr import AutoModel
            except ImportError as exc:
                raise SpeechModelUnavailable(
                    "本地语音依赖未安装，请重新执行 apps/api/requirements-dev.txt 的安装命令"
                ) from exc
            try:
                model_reference = _cached_model_reference(self.model_name)
                vad_reference = _cached_model_reference(self.vad_model_name)
                self._model = AutoModel(
                    model=model_reference,
                    vad_model=vad_reference,
                    vad_kwargs={"max_single_segment_time": 30_000},
                    device=self.device,
                    disable_pbar=True,
                    trust_remote_code=False,
                    disable_update=True,
                )
            except Exception as exc:
                raise SpeechModelUnavailable(
                    f"SenseVoiceSmall 加载失败：{exc}"
                ) from exc
        return self._model

    def transcribe(self, audio_bytes: bytes) -> TranscriptionResult:
        info = inspect_sensevoice_wav(audio_bytes, self.max_audio_seconds)
        model = self._load_model()
        with TemporaryDirectory(prefix="diagnostic-tutor-speech-") as temp_dir:
            audio_path = Path(temp_dir) / "recording.wav"
            audio_path.write_bytes(audio_bytes)
            try:
                with self._inference_lock:
                    response = model.generate(
                        input=str(audio_path),
                        cache={},
                        language="auto",
                        use_itn=True,
                        disable_pbar=True,
                        batch_size_s=60,
                        merge_vad=True,
                        merge_length_s=15,
                    )
            except Exception as exc:
                raise SpeechModelUnavailable(f"本地语音识别失败：{exc}") from exc

        if not response or not isinstance(response[0], dict):
            raise InvalidSpeechAudio("没有识别到清晰语音，请靠近麦克风后重试")
        raw_text = str(response[0].get("text") or "").strip()
        text = _SENSEVOICE_TAG.sub("", raw_text).strip()
        if not text:
            raise InvalidSpeechAudio("没有识别到清晰语音，请靠近麦克风后重试")
        language, emotion, event = _sensevoice_metadata(raw_text)
        return TranscriptionResult(
            text=text,
            duration_seconds=info.duration_seconds,
            language=language,
            emotion=emotion,
            event=event,
        )

    def transcribe_pcm16(self, pcm_bytes: bytes) -> TranscriptionResult:
        return self.transcribe(pcm16_to_wav(pcm_bytes))

    def create_stream_vad_session(self) -> SenseVoiceVadSession:
        model = self._load_model()
        if getattr(model, "vad_model", None) is None:
            raise SpeechModelUnavailable("SenseVoiceSmall 的流式 VAD 未加载")
        return SenseVoiceVadSession(self, model)


class SenseVoiceVadSession:
    """Connection-local cache for FunASR's streaming FSMN-VAD."""

    def __init__(self, transcriber: SenseVoiceTranscriber, model: Any) -> None:
        self._transcriber = transcriber
        self._model = model
        self._cache: dict[str, Any] = {}
        self._closed = False

    def feed(self, pcm_bytes: bytes, *, is_final: bool = False) -> list[VadUpdate]:
        if self._closed:
            return []
        if len(pcm_bytes) % SENSEVOICE_SAMPLE_WIDTH:
            raise InvalidSpeechAudio("流式录音数据不是有效的 16 位 PCM")
        if not pcm_bytes:
            if is_final:
                self._closed = True
            return []

        try:
            import numpy as np

            samples = np.frombuffer(pcm_bytes, dtype="<i2").astype(np.float32) / 32768.0
            with self._transcriber._inference_lock:
                vad_kwargs = dict(self._model.vad_kwargs)
                frontend = vad_kwargs.pop("frontend")
                tokenizer = vad_kwargs.pop("tokenizer", None)
                for runtime_key in (
                    "cache",
                    "chunk_size",
                    "data_in",
                    "dynamic_silence",
                    "fs",
                    "is_final",
                    "is_streaming_input",
                    "key",
                    "max_end_silence_time",
                ):
                    vad_kwargs.pop(runtime_key, None)
                response, _ = self._model.vad_model.inference(
                    data_in=[samples],
                    key=["speech-stream"],
                    tokenizer=tokenizer,
                    frontend=frontend,
                    cache=self._cache,
                    is_final=is_final,
                    is_streaming_input=True,
                    chunk_size=100,
                    dynamic_silence=False,
                    max_end_silence_time=600,
                    fs=SENSEVOICE_SAMPLE_RATE,
                    **vad_kwargs,
                )
        except Exception as exc:
            raise SpeechModelUnavailable(f"流式语音活动检测失败：{exc}") from exc
        finally:
            if is_final:
                self._closed = True

        updates: list[VadUpdate] = []
        if not response or not isinstance(response[0], dict):
            return updates
        for segment in response[0].get("value") or []:
            if not isinstance(segment, (list, tuple)) or len(segment) != 2:
                continue
            raw_start, raw_end = int(segment[0]), int(segment[1])
            updates.append(
                VadUpdate(
                    start_ms=raw_start if raw_start >= 0 else None,
                    end_ms=raw_end if raw_end >= 0 else None,
                )
            )
        return updates
