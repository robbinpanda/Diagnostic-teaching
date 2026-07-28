import assert from "node:assert/strict";
import test from "node:test";
import {
  joinSpeechSegments,
  stripInterimTrailingPunctuation
} from "../lib/speech-text";

test("joinSpeechSegments does not insert spaces around Chinese dictation", () => {
  assert.equal(
    joinSpeechSegments(["已知椭圆", "4分之X方", "加3分之Y方", "等于1。"]),
    "已知椭圆4分之X方加3分之Y方等于1。"
  );
  assert.equal(joinSpeechSegments(["hello", "world"]), "hello world");
});

test("stripInterimTrailingPunctuation keeps provisional dictation open", () => {
  assert.equal(stripInterimTrailingPunctuation("已知椭圆。"), "已知椭圆");
  assert.equal(stripInterimTrailingPunctuation("等于1！"), "等于1");
});
