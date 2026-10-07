"""Pagination helpers for catalog listings."""

from collections.abc import Sequence
from typing import TypeVar

T = TypeVar("T")


def page_count(total: int, per_page: int) -> int:
    """Return how many pages ``total`` items need at ``per_page`` per page."""
    if per_page < 1:
        raise ValueError("per_page must be at least 1")
    return (total + per_page - 1) // per_page


def page_slice(items: Sequence[T], page: int, per_page: int) -> list[T]:
    """Return the items shown on the 1-based ``page``."""
    if page < 1 or per_page < 1:
        raise ValueError("page and per_page must be at least 1")
    start = page * per_page
    return list(items[start : start + per_page])
