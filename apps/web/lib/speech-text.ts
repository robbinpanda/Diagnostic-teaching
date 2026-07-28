const CJK_OR_FULLWIDTH_AT_END =
  /[\u3000-\u303f\u3040-\u30ff\u3400-\u9fff\uff00-\uffef]$/u;
const CJK_OR_FULLWIDTH_AT_START =
  /^[\u3000-\u303f\u3040-\u30ff\u3400-\u9fff\uff00-\uffef]/u;

export function stripInterimTrailingPunctuation(text: string): string {
  return text.trim().replace(/[。！？.!?]+$/u, "");
}

export function joinSpeechSegments(segments: string[]): string {
  return segments
    .map((segment) => segment.trim())
    .filter(Boolean)
    .reduce((combined, segment) => {
      if (!combined) return segment;
      const needsSpace = !CJK_OR_FULLWIDTH_AT_END.test(combined)
        && !CJK_OR_FULLWIDTH_AT_START.test(segment);
      return `${combined}${needsSpace ? " " : ""}${segment}`;
    }, "");
}
