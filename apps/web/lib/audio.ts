const SENSEVOICE_SAMPLE_RATE = 16_000;

export function resampleFloat32ToPcm16(
  samples: Float32Array,
  sourceSampleRate: number,
  targetSampleRate = SENSEVOICE_SAMPLE_RATE
): ArrayBuffer {
  if (!samples.length || sourceSampleRate <= 0 || targetSampleRate <= 0) {
    return new ArrayBuffer(0);
  }
  const outputLength = Math.max(
    1,
    Math.round(samples.length * targetSampleRate / sourceSampleRate)
  );
  const output = new ArrayBuffer(outputLength * 2);
  const view = new DataView(output);
  const ratio = sourceSampleRate / targetSampleRate;

  for (let index = 0; index < outputLength; index += 1) {
    const sourcePosition = Math.min(samples.length - 1, index * ratio);
    const lowerIndex = Math.floor(sourcePosition);
    const upperIndex = Math.min(samples.length - 1, lowerIndex + 1);
    const fraction = sourcePosition - lowerIndex;
    const interpolated = samples[lowerIndex]
      + (samples[upperIndex] - samples[lowerIndex]) * fraction;
    const value = Math.max(-1, Math.min(1, interpolated));
    view.setInt16(
      index * 2,
      value < 0 ? value * 0x8000 : value * 0x7fff,
      true
    );
  }
  return output;
}

export function encodePcm16Wav(samples: Float32Array, sampleRate = SENSEVOICE_SAMPLE_RATE): Blob {
  const headerSize = 44;
  const bytesPerSample = 2;
  const buffer = new ArrayBuffer(headerSize + samples.length * bytesPerSample);
  const view = new DataView(buffer);

  function writeAscii(offset: number, value: string) {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  }

  writeAscii(0, "RIFF");
  view.setUint32(4, buffer.byteLength - 8, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, samples.length * bytesPerSample, true);

  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(
      headerSize + index * bytesPerSample,
      value < 0 ? value * 0x8000 : value * 0x7fff,
      true
    );
  }
  return new Blob([buffer], { type: "audio/wav" });
}

export async function recordingBlobToSenseVoiceWav(recording: Blob): Promise<Blob> {
  if (!recording.size) throw new Error("录音内容为空，请重试");
  const AudioContextClass = window.AudioContext;
  if (!AudioContextClass || typeof window.OfflineAudioContext === "undefined") {
    throw new Error("当前浏览器不支持本地录音转换，请使用最新版 Edge 或 Chrome");
  }

  const audioContext = new AudioContextClass();
  try {
    const decoded = await audioContext.decodeAudioData(await recording.arrayBuffer());
    const targetFrameCount = Math.max(
      1,
      Math.ceil(decoded.duration * SENSEVOICE_SAMPLE_RATE)
    );
    const offline = new OfflineAudioContext(1, targetFrameCount, SENSEVOICE_SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    return encodePcm16Wav(rendered.getChannelData(0), SENSEVOICE_SAMPLE_RATE);
  } catch (error) {
    throw new Error(
      error instanceof Error && error.message
        ? `录音转换失败：${error.message}`
        : "录音转换失败，请重试"
    );
  } finally {
    await audioContext.close();
  }
}
