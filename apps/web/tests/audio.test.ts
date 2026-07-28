import assert from "node:assert/strict";
import test from "node:test";
import { encodePcm16Wav, resampleFloat32ToPcm16 } from "../lib/audio";

test("encodePcm16Wav creates a 16 kHz mono PCM WAV", async () => {
  const wav = encodePcm16Wav(new Float32Array([0, 0.5, -0.5]));
  const bytes = new Uint8Array(await wav.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const ascii = (start: number, length: number) =>
    String.fromCharCode(...bytes.slice(start, start + length));

  assert.equal(wav.type, "audio/wav");
  assert.equal(ascii(0, 4), "RIFF");
  assert.equal(ascii(8, 4), "WAVE");
  assert.equal(view.getUint16(20, true), 1);
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(24, true), 16_000);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true), 6);
});

test("resampleFloat32ToPcm16 produces 16-bit streaming PCM", () => {
  const input = new Float32Array(4_800);
  input.fill(0.5);

  const pcm = resampleFloat32ToPcm16(input, 48_000);
  const view = new DataView(pcm);

  assert.equal(pcm.byteLength, 3_200);
  assert.equal(view.getInt16(0, true), 16_383);
  assert.equal(view.getInt16(pcm.byteLength - 2, true), 16_383);
});
