"""Inclusive date range utilities."""

import calendar
import re
from collections.abc import Iterable, Iterator
from datetime import date, timedelta

DateRange = tuple[date, date]

_ONE_DAY = timedelta(days=1)
_DATE = r"(\d{4})-(\d{2})-(\d{2})"
_RANGE = re.compile(rf"{_DATE}(?:\.\.{_DATE})?")


def parse_range(text: str) -> DateRange:
    """Parse ``YYYY-MM-DD..YYYY-MM-DD`` or a single ``YYYY-MM-DD``."""
    match = _RANGE.fullmatch(text.strip())
    if match is None:
        raise ValueError(f"invalid date range: {text!r}")
    groups = match.groups()
    start = date(*map(int, groups[:3]))
    end = date(*map(int, groups[3:])) if groups[3] is not None else start
    if start > end:
        raise ValueError("range start is after range end")
    return start, end


def iter_days(start: date, end: date) -> Iterator[date]:
    """Yield every day from ``start`` to ``end`` inclusive."""
    day = start
    while day <= end:
        yield day
        day += _ONE_DAY


def merge_ranges(ranges: Iterable[DateRange]) -> list[DateRange]:
    """Merge overlapping or adjacent ranges."""
    merged: list[DateRange] = []
    for start, end in sorted(ranges):
        if merged and start <= merged[-1][1] + _ONE_DAY:
            last_start, last_end = merged[-1]
            merged[-1] = (last_start, max(last_end, end))
        else:
            merged.append((start, end))
    return merged


def business_days(start: date, end: date, holidays: Iterable[date] = ()) -> int:
    """Count Monday-Friday days in ``[start, end]`` excluding holidays."""
    excluded = set(holidays)
    return sum(
        1 for day in iter_days(start, end) if day.weekday() < 5 and day not in excluded
    )


def month_span(year: int, month: int) -> DateRange:
    """Return the first and last day of a month."""
    if not 1 <= month <= 12:
        raise ValueError("month must be between 1 and 12")
    last = calendar.monthrange(year, month)[1]
    return date(year, month, 1), date(year, month, last)


def overlap_days(a: DateRange, b: DateRange) -> int:
    """Return how many days two inclusive ranges share."""
    start = max(a[0], b[0])
    end = min(a[1], b[1])
    return max((end - start).days + 1, 0)
