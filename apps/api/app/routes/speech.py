from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool

from app.services.sensevoice_transcriber import (
    SENSEVOICE_SAMPLE_RATE,
    InvalidSpeechAudio,
    SpeechModelUnavailable,
)

router = APIRouter(prefix="/api/speech", tags=["speech"])
_BYTES_PER_SECOND = SENSEVOICE_SAMPLE_RATE * 2
_PARTIAL_INTERVAL_BYTES = int(_BYTES_PER_SECOND * 1.2)
_MIN_TRANSCRIPTION_BYTES = int(_BYTES_PER_SECOND * 0.35)
_MAX_WAV_UPLOAD_BYTES = 16 * 1024 * 1024
_ALLOWED_WEB_ORIGINS = {"http://127.0.0.1:3000", "http://localhost:3000"}


@router.get("/status")
def speech_status(request: Request) -> dict[str, object]:
    transcriber = request.app.state.speech_transcriber
    return {
        "available": transcriber.available,
        "loaded": transcriber.loaded,
        "model": transcriber.model_name,
        "device": transcriber.device,
        "stream_segment_seconds": transcriber.stream_segment_seconds,
        "max_upload_bytes": _MAX_WAV_UPLOAD_BYTES,
        "commit_silence_ms": transcriber.commit_silence_ms,
    }


@router.post("/transcribe")
async def transcribe_speech(request: Request) -> dict[str, object]:
    content_type = request.headers.get("content-type", "").partition(";")[0].strip().lower()
    if content_type not in {"audio/wav", "audio/x-wav", "audio/wave"}:
        raise HTTPException(status_code=415, detail="只支持 16 kHz 单声道 PCM WAV 录音")

    transcriber = request.app.state.speech_transcriber
    content_length = request.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) > _MAX_WAV_UPLOAD_BYTES:
                raise HTTPException(
                    status_code=413,
                    detail="WAV 文件不能超过 16 MiB，请改用实时语音输入",
                )
        except ValueError:
            pass
    audio_buffer = bytearray()
    async for chunk in request.stream():
        if len(audio_buffer) + len(chunk) > _MAX_WAV_UPLOAD_BYTES:
            raise HTTPException(
                status_code=413,
                detail="WAV 文件不能超过 16 MiB，请改用实时语音输入",
            )
        audio_buffer.extend(chunk)

    try:
        result = await run_in_threadpool(transcriber.transcribe, bytes(audio_buffer))
    except InvalidSpeechAudio as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except SpeechModelUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return {
        "text": result.text,
        "duration_seconds": round(result.duration_seconds, 3),
        "language": result.language,
        "emotion": result.emotion,
        "event": result.event,
    }


async def _send_stream_transcript(
    websocket: WebSocket,
    transcriber,
    pcm_bytes: bytes,
    *,
    event_type: str,
) -> str | None:
    if len(pcm_bytes) < _MIN_TRANSCRIPTION_BYTES:
        return None
    try:
        result = await run_in_threadpool(transcriber.transcribe_pcm16, pcm_bytes)
    except InvalidSpeechAudio:
        return None
    await websocket.send_json(
        {
            "type": event_type,
            "text": result.text,
            "duration_seconds": round(result.duration_seconds, 3),
            "language": result.language,
            "emotion": result.emotion,
            "event": result.event,
        }
    )
    return result.text


@router.websocket("/stream")
async def stream_speech(websocket: WebSocket) -> None:
    origin = websocket.headers.get("origin")
    if origin and origin not in _ALLOWED_WEB_ORIGINS:
        await websocket.close(code=1008)
        return
    await websocket.accept()
    transcriber = websocket.app.state.speech_transcriber
    commit_silence_bytes = (
        _BYTES_PER_SECOND * transcriber.commit_silence_ms // 1_000
    )
    try:
        vad_session = await run_in_threadpool(transcriber.create_stream_vad_session)
    except SpeechModelUnavailable as exc:
        await websocket.send_json({"type": "error", "message": str(exc)})
        await websocket.close(code=1011)
        return

    await websocket.send_json(
        {
            "type": "ready",
            "sample_rate": SENSEVOICE_SAMPLE_RATE,
            "partial_interval_ms": 1_200,
            "commit_silence_ms": transcriber.commit_silence_ms,
            "stream_segment_seconds": transcriber.stream_segment_seconds,
        }
    )

    audio_buffer = bytearray()
    group_start_byte: int | None = None
    pending_end_byte: int | None = None
    speech_active = False
    last_partial_byte = 0
    current_partial: str | None = None
    recognized_any = False
    max_window_bytes = transcriber.stream_segment_seconds * _BYTES_PER_SECOND

    async def reset_stream_window() -> None:
        nonlocal vad_session, group_start_byte, pending_end_byte, speech_active
        nonlocal last_partial_byte, current_partial
        audio_buffer.clear()
        group_start_byte = None
        pending_end_byte = None
        speech_active = False
        last_partial_byte = 0
        current_partial = None
        vad_session = await run_in_threadpool(transcriber.create_stream_vad_session)

    async def finish_active_group(end_byte: int) -> None:
        nonlocal recognized_any
        if group_start_byte is None:
            return
        end_byte = max(group_start_byte, min(end_byte, len(audio_buffer)))
        segment = bytes(audio_buffer[group_start_byte:end_byte])
        final_text = await _send_stream_transcript(
            websocket,
            transcriber,
            segment,
            event_type="final",
        )
        if final_text is None and current_partial:
            await websocket.send_json(
                {
                    "type": "final",
                    "text": current_partial,
                    "duration_seconds": round(len(segment) / _BYTES_PER_SECOND, 3),
                    "language": None,
                    "emotion": None,
                    "event": None,
                }
            )
            final_text = current_partial
        recognized_any = recognized_any or bool(final_text)
        await reset_stream_window()

    try:
        while True:
            message = await websocket.receive()
            if message["type"] == "websocket.disconnect":
                break

            pcm_chunk = message.get("bytes")
            if pcm_chunk is not None:
                if not pcm_chunk:
                    continue
                if len(pcm_chunk) % 2:
                    raise InvalidSpeechAudio("流式录音数据不是有效的 16 位 PCM")
                if len(pcm_chunk) > max_window_bytes:
                    await websocket.send_json(
                        {
                            "type": "error",
                            "message": "单个流式音频块过大，请使用浏览器麦克风实时发送",
                        }
                    )
                    await websocket.close(code=1009)
                    return

                audio_buffer.extend(pcm_chunk)
                updates = await run_in_threadpool(vad_session.feed, pcm_chunk)
                for update in updates:
                    if update.start_ms is not None:
                        start_byte = min(
                            len(audio_buffer),
                            max(0, update.start_ms * _BYTES_PER_SECOND // 1_000),
                        )
                        if group_start_byte is None:
                            group_start_byte = start_byte
                            last_partial_byte = start_byte
                        else:
                            last_partial_byte = max(last_partial_byte, start_byte)
                        pending_end_byte = None
                        speech_active = True
                    if update.end_ms is not None and group_start_byte is not None:
                        pending_end_byte = min(
                            len(audio_buffer),
                            max(
                                group_start_byte,
                                update.end_ms * _BYTES_PER_SECOND // 1_000,
                            ),
                        )
                        speech_active = False

                if (
                    group_start_byte is not None
                    and pending_end_byte is not None
                    and len(audio_buffer) - pending_end_byte >= commit_silence_bytes
                ):
                    await finish_active_group(pending_end_byte)
                elif len(audio_buffer) >= max_window_bytes:
                    if group_start_byte is not None:
                        await finish_active_group(len(audio_buffer))
                    else:
                        await reset_stream_window()
                elif (
                    group_start_byte is not None
                    and speech_active
                    and len(audio_buffer) - last_partial_byte >= _PARTIAL_INTERVAL_BYTES
                ):
                    partial = await _send_stream_transcript(
                        websocket,
                        transcriber,
                        bytes(audio_buffer[group_start_byte:]),
                        event_type="partial",
                    )
                    if partial:
                        current_partial = partial
                    last_partial_byte = len(audio_buffer)
                continue

            raw_text = message.get("text")
            if raw_text is None:
                continue
            try:
                command = json.loads(raw_text)
            except json.JSONDecodeError:
                command = {}
            if command.get("type") != "stop":
                continue

            if group_start_byte is not None:
                await finish_active_group(pending_end_byte or len(audio_buffer))
            if not recognized_any:
                await websocket.send_json(
                    {"type": "empty", "message": "没有检测到清晰语音，请靠近麦克风后重试"}
                )
            await websocket.send_json({"type": "done"})
            await websocket.close(code=1000)
            return
    except WebSocketDisconnect:
        return
    except (InvalidSpeechAudio, SpeechModelUnavailable) as exc:
        try:
            await websocket.send_json({"type": "error", "message": str(exc)})
            await websocket.close(code=1011)
        except RuntimeError:
            pass
