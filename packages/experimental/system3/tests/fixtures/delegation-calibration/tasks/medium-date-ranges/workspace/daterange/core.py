"""Inclusive date range utilities."""

from collections.abc import Iterable, Iterator
from datetime import date

DateRange = tuple[date, date]


def parse_range(text: str) -> DateRange:
    """Parse ``YYYY-MM-DD..YYYY-MM-DD`` or a single ``YYYY-MM-DD``."""
    raise NotImplementedError


def iter_days(start: date, end: date) -> Iterator[date]:
    """Yield every day from ``start`` to ``end`` inclusive."""
    raise NotImplementedError


def merge_ranges(ranges: Iterable[DateRange]) -> list[DateRange]:
    """Merge overlapping or adjacent ranges."""
    raise NotImplementedError


def business_days(start: date, end: date, holidays: Iterable[date] = ()) -> int:
    """Count Monday-Friday days in ``[start, end]`` excluding holidays."""
    raise NotImplementedError


def month_span(year: int, month: int) -> DateRange:
    """Return the first and last day of a month."""
    raise NotImplementedError


def overlap_days(a: DateRange, b: DateRange) -> int:
    """Return how many days two inclusive ranges share."""
    raise NotImplementedError
