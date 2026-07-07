from __future__ import annotations

import re

# 匹配 JSON 里 `"message"` 字符串字段的开口，跳过空白，到内容起点的第一个 `"` 之后。
_MESSAGE_OPEN = re.compile(r'"message"\s*:\s*"')


def _decode_message_segment(raw: str, start: int) -> tuple[str, bool]:
    r"""从字符串字段的 start 起扫描，返回 (已确定的可见文本, 是否遇到结束引号)。

    逐字符处理 JSON 字符串转义：
    - 普通字符：直接 append
    - 反斜杠转义：\n \t \r \" \\ \/ \uXXXX 全部正确解码
    - 末尾若停在半个转义上（孤立反斜杠或不完整 \uXXXX），暂不发，等下次 feed 补全
    - 遇未转义的 `"` 即字段结束
    """
    out: list[str] = []
    i = start
    n = len(raw)
    while i < n:
        c = raw[i]
        if c == '"':
            return "".join(out), True
        if c == "\\":
            if i + 1 >= n:
                # 孤立反斜杠，等下一段补全
                break
            nxt = raw[i + 1]
            if nxt == "n":
                out.append("\n")
                i += 2
            elif nxt == "t":
                out.append("\t")
                i += 2
            elif nxt == "r":
                out.append("\r")
                i += 2
            elif nxt == '"':
                out.append('"')
                i += 2
            elif nxt == "\\":
                out.append("\\")
                i += 2
            elif nxt == "/":
                out.append("/")
                i += 2
            elif nxt == "u":
                if i + 6 > n:
                    # \uXXXX 不完整，等补全
                    break
                hex_part = raw[i + 2 : i + 6]
                try:
                    out.append(chr(int(hex_part, 16)))
                except ValueError:
                    break
                i += 6
            else:
                # 未知转义，按字面后面的字符吐出
                out.append(nxt)
                i += 2
        else:
            out.append(c)
            i += 1
    return "".join(out), False


class MessageStreamExtractor:
    """从 LLM 流式 raw 累积里实时提取 `"message": "..."` 字段的可见文本。

    用法：每收到一段 LLM delta 调 feed(delta) → 得到这段新产生的可见字符增量；
    流结束后取 raw 拿完整原文，交给最终解析器拿 phase / checkpoint 等。

    为什么这样设计：LLM 一次 LLM 调用要返回完整结构化 JSON 才能解析
    checkpoint，但 message 字段的内容可以"边生成边透传"给前端做打字机效果。
    """

    def __init__(self) -> None:
        self.raw = ""
        self._message_start: int | None = None
        self._terminated = False
        self._emitted: int = 0  # 已经发出去的可见字符数

    def feed(self, delta: str) -> str:
        if not delta or self._terminated:
            return ""
        self.raw += delta
        if self._message_start is None:
            m = _MESSAGE_OPEN.search(self.raw)
            if not m:
                return ""
            self._message_start = m.end()
        visible, terminated = _decode_message_segment(self.raw, self._message_start)
        if self._emitted >= len(visible):
            # 还没有新可见字符（可能停在半个转义上）
            if terminated:
                self._terminated = True
            return ""
        inc = visible[self._emitted :]
        self._emitted = len(visible)
        if terminated:
            self._terminated = True
        return inc

    @property
    def finished(self) -> bool:
        return self._terminated

    def visible_so_far(self) -> str:
        """已确定的可见文本（不含未补全的转义）。"""
        if self._message_start is None:
            return ""
        visible, _ = _decode_message_segment(self.raw, self._message_start)
        return visible