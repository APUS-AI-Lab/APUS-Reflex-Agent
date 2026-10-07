"""Greedy word wrapping."""


def wrap(text: str, width: int) -> list[str]:
    """Wrap ``text`` into lines of at most ``width`` characters.

    Words are never split; a word longer than ``width`` occupies its own line.
    """
    if width < 1:
        raise ValueError("width must be at least 1")
    lines: list[str] = []
    current = ""
    for word in text.split():
        if not current:
            current = word
        elif len(current) + 1 + len(word) < width:
            current += " " + word
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines
