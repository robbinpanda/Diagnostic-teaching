"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { speechStreamUrl, type SpeechStreamEvent } from "../lib/api";
import { resampleFloat32ToPcm16 } from "../lib/audio";
import {
  joinSpeechSegments,
  stripInterimTrailingPunctuation
} from "../lib/speech-text";

export type SpeechInputPhase = "idle" | "requesting" | "recording" | "transcribing";

type SpeechInputOptions = {
  onRecordingStart?: () => void;
  onTranscript: (text: string, isFinal: boolean) => void;
  onError: (message: string) => void;
};

export function useSpeechInput({
  onRecordingStart,
  onTranscript,
  onError
}: SpeechInputOptions) {
  const [phase, setPhase] = useState<SpeechInputPhase>("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const streamRef = useRef<MediaStream | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const silentGainRef = useRef<GainNode | null>(null);
  const intervalRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const sessionFinishedRef = useRef(false);
  const transcriptSeenRef = useRef(false);
  const finalSegmentsRef = useRef<string[]>([]);
  const onRecordingStartRef = useRef(onRecordingStart);
  const onTranscriptRef = useRef(onTranscript);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onRecordingStartRef.current = onRecordingStart;
    onTranscriptRef.current = onTranscript;
    onErrorRef.current = onError;
  }, [onError, onRecordingStart, onTranscript]);

  const clearTimers = useCallback(() => {
    if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
    intervalRef.current = null;
  }, []);

  const releaseCapture = useCallback(() => {
    clearTimers();
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    silentGainRef.current?.disconnect();
    processorRef.current = null;
    sourceRef.current = null;
    silentGainRef.current = null;
    const audioContext = audioContextRef.current;
    audioContextRef.current = null;
    if (audioContext && audioContext.state !== "closed") {
      void audioContext.close().catch(() => undefined);
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, [clearTimers]);

  function finishSession({ closeSocket = false }: { closeSocket?: boolean } = {}) {
    sessionFinishedRef.current = true;
    releaseCapture();
    const socket = socketRef.current;
    socketRef.current = null;
    if (closeSocket && socket && socket.readyState < WebSocket.CLOSING) socket.close();
    if (mountedRef.current) {
      setPhase("idle");
      setElapsedSeconds(0);
    }
  }

  function combinedTranscript(partial = "") {
    return joinSpeechSegments([...finalSegmentsRef.current, partial]);
  }

  function handleStreamEvent(event: SpeechStreamEvent) {
    if (event.type === "partial") {
      transcriptSeenRef.current = true;
      onTranscriptRef.current(
        combinedTranscript(stripInterimTrailingPunctuation(event.text)),
        false
      );
      return;
    }
    if (event.type === "final") {
      const text = event.text.trim();
      if (text) finalSegmentsRef.current.push(text);
      transcriptSeenRef.current = transcriptSeenRef.current || Boolean(text);
      onTranscriptRef.current(combinedTranscript(), true);
      return;
    }
    if (event.type === "empty") {
      if (!transcriptSeenRef.current) onErrorRef.current(event.message);
      return;
    }
    if (event.type === "error") {
      onErrorRef.current(event.message);
      finishSession({ closeSocket: true });
      return;
    }
    if (event.type === "done") finishSession();
  }

  function startCapture(stream: MediaStream, socket: WebSocket) {
    const AudioContextClass = window.AudioContext;
    const audioContext = new AudioContextClass();
    const source = audioContext.createMediaStreamSource(stream);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    const silentGain = audioContext.createGain();
    silentGain.gain.value = 0;
    processor.onaudioprocess = (event) => {
      if (socket.readyState !== WebSocket.OPEN) return;
      const pcm = resampleFloat32ToPcm16(
        event.inputBuffer.getChannelData(0),
        audioContext.sampleRate
      );
      if (pcm.byteLength) socket.send(pcm);
    };
    source.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(audioContext.destination);
    audioContextRef.current = audioContext;
    sourceRef.current = source;
    processorRef.current = processor;
    silentGainRef.current = silentGain;
    void audioContext.resume();

    onRecordingStartRef.current?.();
    if (!mountedRef.current) return;
    setPhase("recording");
    const startedAt = Date.now();
    intervalRef.current = window.setInterval(() => {
      setElapsedSeconds((Date.now() - startedAt) / 1_000);
    }, 100);
  }

  function stopRecording() {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      finishSession({ closeSocket: true });
      return;
    }
    releaseCapture();
    if (mountedRef.current) setPhase("transcribing");
    socket.send(JSON.stringify({ type: "stop" }));
  }

  async function startRecording() {
    if (phase !== "idle") return;
    if (
      typeof navigator.mediaDevices?.getUserMedia !== "function"
      || typeof window.AudioContext === "undefined"
      || typeof window.WebSocket === "undefined"
    ) {
      onErrorRef.current("当前浏览器不支持实时麦克风转写，请使用最新版 Edge 或 Chrome");
      return;
    }

    setPhase("requesting");
    setElapsedSeconds(0);
    sessionFinishedRef.current = false;
    transcriptSeenRef.current = false;
    finalSegmentsRef.current = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true
        }
      });
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;

      const socket = new WebSocket(speechStreamUrl());
      socket.binaryType = "arraybuffer";
      socketRef.current = socket;
      socket.onmessage = (message) => {
        let event: SpeechStreamEvent;
        try {
          event = JSON.parse(String(message.data)) as SpeechStreamEvent;
        } catch {
          onErrorRef.current("实时语音服务返回了无法解析的数据");
          finishSession({ closeSocket: true });
          return;
        }
        if (event.type === "ready") {
          try {
            startCapture(stream, socket);
          } catch {
            onErrorRef.current("无法启动浏览器实时录音处理，请使用最新版 Edge 或 Chrome");
            finishSession({ closeSocket: true });
          }
        } else {
          handleStreamEvent(event);
        }
      };
      socket.onerror = () => {
        if (!sessionFinishedRef.current) {
          onErrorRef.current("无法连接本地实时语音服务，请确认后端已经启动");
          finishSession({ closeSocket: true });
        }
      };
      socket.onclose = () => {
        if (!sessionFinishedRef.current) {
          onErrorRef.current("实时语音连接已中断，请重试");
          finishSession();
        }
      };
    } catch (error) {
      finishSession({ closeSocket: true });
      const message = error instanceof DOMException && error.name === "NotAllowedError"
        ? "麦克风权限被拒绝，请在浏览器地址栏中允许麦克风后重试"
        : "无法打开麦克风，请检查浏览器权限和系统录音设备";
      onErrorRef.current(message);
    }
  }

  useEffect(() => () => {
    mountedRef.current = false;
    sessionFinishedRef.current = true;
    releaseCapture();
    const socket = socketRef.current;
    socketRef.current = null;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
  }, [releaseCapture]);

  return {
    phase,
    elapsedSeconds,
    busy: phase !== "idle",
    toggle: () => {
      if (phase === "recording") stopRecording();
      else if (phase === "idle") void startRecording();
    }
  };
}
