"""Notification message rendering."""

from formatting.wrap import wrap


def format_message(title: str, body: str, width: int = 40) -> str:
    """Render a notification as an upper-cased title line plus wrapped body."""
    lines = [title.upper(), "=" * min(len(title), width)]
    lines.extend(wrap(body, width))
    return "\n".join(lines)
