"""Identifier case conversion."""

import re

_BOUNDARY = re.compile(r"(?<=[a-z0-9])(?=[A-Z])")


def snake_case(name: str) -> str:
    """Convert ``CamelCase`` or ``mixedCase`` to ``snake_case``."""
    return _BOUNDARY.sub("_", name).replace("-", "_").lower()
