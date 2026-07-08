"use client";

import katex from "katex";

type MathSegment =
  | { type: "text"; content: string }
  | { type: "math"; content: string; display: boolean; source: string };

type Props = {
  text: string;
  className?: string;
};

function findClosingDelimiter(text: string, start: number, delimiter: string): number {
  let index = start;
  while (index < text.length) {
    const found = text.indexOf(delimiter, index);
    if (found === -1) return -1;
    if (found === 0 || text[found - 1] !== "\\") return found;
    index = found + delimiter.length;
  }
  return -1;
}

function parseMathSegments(text: string): MathSegment[] {
  const segments: MathSegment[] = [];
  let cursor = 0;
  let textStart = 0;

  function pushText(end: number) {
    if (end > textStart) {
      segments.push({ type: "text", content: text.slice(textStart, end) });
    }
  }

  function pushDelimitedMath(open: string, close: string, display: boolean): boolean {
    if (!text.startsWith(open, cursor)) return false;
    const contentStart = cursor + open.length;
    const contentEnd = findClosingDelimiter(text, contentStart, close);
    if (contentEnd === -1) return false;
    const content = text.slice(contentStart, contentEnd).trim();
    if (!content) return false;
    pushText(cursor);
    segments.push({
      type: "math",
      content,
      display,
      source: text.slice(cursor, contentEnd + close.length)
    });
    cursor = contentEnd + close.length;
    textStart = cursor;
    return true;
  }

  while (cursor < text.length) {
    if (
      pushDelimitedMath("\\[", "\\]", true) ||
      pushDelimitedMath("\\(", "\\)", false) ||
      pushDelimitedMath("$$", "$$", true) ||
      pushDelimitedMath("$", "$", false)
    ) {
      continue;
    }
    cursor += 1;
  }

  pushText(text.length);
  return segments;
}

function renderMathToHtml(content: string, display: boolean): string {
  return katex.renderToString(content, {
    displayMode: display,
    throwOnError: false,
    strict: "ignore",
    trust: false
  });
}

export function MathText({ text, className }: Props) {
  const segments = parseMathSegments(text);
  return (
    <span className={className ? `mathText ${className}` : "mathText"}>
      {segments.map((segment, index) => {
        if (segment.type === "text") {
          return <span key={index}>{segment.content}</span>;
        }
        return (
          <span
            key={index}
            className={segment.display ? "mathDisplay" : "mathInline"}
            dangerouslySetInnerHTML={{ __html: renderMathToHtml(segment.content, segment.display) }}
          />
        );
      })}
    </span>
  );
}
