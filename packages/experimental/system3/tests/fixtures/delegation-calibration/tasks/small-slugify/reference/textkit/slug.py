"""URL slug generation for post titles."""

import re
import unicodedata

_SEPARATORS = re.compile(r"[^a-z0-9]+")


def slugify(text: str, max_length: int = 50) -> str:
    """Convert ``text`` into a URL slug of at most ``max_length`` characters."""
    if max_length < 1:
        raise ValueError("max_length must be at least 1")
    decomposed = unicodedata.normalize("NFKD", text)
    stripped = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    slug = _SEPARATORS.sub("-", stripped.lower()).strip("-")
    slug = slug[:max_length].rstrip("-")
    return slug or "untitled"
