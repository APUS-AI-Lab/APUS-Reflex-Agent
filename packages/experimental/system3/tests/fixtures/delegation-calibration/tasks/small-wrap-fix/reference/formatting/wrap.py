"""Greedy word wrapping."""

import re

_PARAGRAPH_BREAK = re.compile(r"\n\s*\n")


def wrap(text: str, width: int) -> list[str]:
    """Wrap ``text`` into lines of at most ``width`` characters.

    Words are never split; a word longer than ``width`` occupies its own line.
    Paragraphs separated by blank lines are wrapped independently and joined
    by a single empty line.
    """
    if width < 1:
        raise ValueError("width must be at least 1")
    lines: list[str] = []
    for paragraph in _PARAGRAPH_BREAK.split(text):
        paragraph_lines = _wrap_paragraph(paragraph, width)
        if not paragraph_lines:
            continue
        if lines:
            lines.append("")
        lines.extend(paragraph_lines)
    return lines


def _wrap_paragraph(text: str, width: int) -> list[str]:
    lines: list[str] = []
    current = ""
    for word in text.split():
        if not current:
            current = word
        elif len(current) + 1 + len(word) <= width:
            current += " " + word
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines
