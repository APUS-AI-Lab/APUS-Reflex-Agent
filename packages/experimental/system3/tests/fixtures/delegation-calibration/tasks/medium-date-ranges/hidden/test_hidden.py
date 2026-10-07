import types
from datetime import date

import pytest
from daterange.core import (
    business_days,
    iter_days,
    merge_ranges,
    month_span,
    overlap_days,
    parse_range,
)

D = date


def test_parse_range_two_dates():
    assert parse_range("2024-01-01..2024-01-31") == (D(2024, 1, 1), D(2024, 1, 31))


def test_parse_range_single_date():
    assert parse_range("2024-03-05") == (D(2024, 3, 5), D(2024, 3, 5))


def test_parse_range_strips_whitespace():
    assert parse_range("  2024-02-01..2024-02-02\n") == (D(2024, 2, 1), D(2024, 2, 2))


def test_parse_range_same_day_range():
    assert parse_range("2024-02-29..2024-02-29") == (D(2024, 2, 29), D(2024, 2, 29))


@pytest.mark.parametrize(
    "text",
    [
        "",
        "abc",
        "2024/01/05",
        "2024-1-5",
        "2024-01-01..",
        "..2024-01-01",
        "2024-01-01...2024-01-02",
        "2024-01-01..2024-01-02..2024-01-03",
        "2023-02-29",
        "2024-13-01",
        "2024-01-32",
        "2024-01-10..2024-01-09",
        "2024-01-01 2024-01-02",
    ],
)
def test_parse_range_invalid(text):
    with pytest.raises(ValueError):
        parse_range(text)


def test_iter_days_inclusive_across_month_and_leap_day():
    days = list(iter_days(D(2024, 2, 27), D(2024, 3, 1)))
    assert days == [D(2024, 2, 27), D(2024, 2, 28), D(2024, 2, 29), D(2024, 3, 1)]


def test_iter_days_single_and_empty():
    assert list(iter_days(D(2024, 1, 1), D(2024, 1, 1))) == [D(2024, 1, 1)]
    assert list(iter_days(D(2024, 1, 2), D(2024, 1, 1))) == []


def test_iter_days_is_generator():
    assert isinstance(iter_days(D(2024, 1, 1), D(2024, 1, 3)), types.GeneratorType)


def test_merge_ranges_overlap_adjacent_and_unsorted():
    ranges = [
        (D(2024, 1, 10), D(2024, 1, 12)),
        (D(2024, 1, 1), D(2024, 1, 3)),
        (D(2024, 1, 4), D(2024, 1, 5)),
        (D(2024, 1, 11), D(2024, 1, 15)),
        (D(2024, 1, 20), D(2024, 1, 20)),
    ]
    assert merge_ranges(ranges) == [
        (D(2024, 1, 1), D(2024, 1, 5)),
        (D(2024, 1, 10), D(2024, 1, 15)),
        (D(2024, 1, 20), D(2024, 1, 20)),
    ]


def test_merge_ranges_gap_of_one_day_not_merged():
    ranges = [(D(2024, 1, 1), D(2024, 1, 3)), (D(2024, 1, 5), D(2024, 1, 6))]
    assert merge_ranges(ranges) == ranges


def test_merge_ranges_contained_and_across_year():
    ranges = [
        (D(2023, 12, 1), D(2024, 1, 31)),
        (D(2023, 12, 10), D(2023, 12, 20)),
        (D(2024, 2, 1), D(2024, 2, 2)),
    ]
    assert merge_ranges(ranges) == [(D(2023, 12, 1), D(2024, 2, 2))]


def test_merge_ranges_accepts_any_iterable_and_empty():
    assert merge_ranges([]) == []
    gen = ((D(2024, 1, d), D(2024, 1, d)) for d in (3, 1, 2))
    assert merge_ranges(gen) == [(D(2024, 1, 1), D(2024, 1, 3))]


def test_business_days_basic_week():
    # 2024-01-01 is a Monday.
    assert business_days(D(2024, 1, 1), D(2024, 1, 7)) == 5
    assert business_days(D(2024, 1, 6), D(2024, 1, 7)) == 0
    assert business_days(D(2024, 1, 5), D(2024, 1, 8)) == 2


def test_business_days_holidays():
    holidays = [
        D(2024, 1, 1),
        D(2024, 1, 1),
        D(2024, 1, 6),
        D(2023, 12, 25),
        D(2024, 1, 3),
    ]
    assert business_days(D(2024, 1, 1), D(2024, 1, 7), holidays) == 3


def test_business_days_holidays_any_iterable():
    holidays = {D(2024, 1, 2)}
    assert business_days(D(2024, 1, 1), D(2024, 1, 2), holidays) == 1


def test_business_days_reversed_range():
    assert business_days(D(2024, 1, 7), D(2024, 1, 1)) == 0


def test_business_days_long_range():
    assert business_days(D(2024, 1, 1), D(2024, 12, 31)) == 262


@pytest.mark.parametrize(
    ("year", "month", "expected"),
    [
        (2024, 2, (D(2024, 2, 1), D(2024, 2, 29))),
        (2023, 2, (D(2023, 2, 1), D(2023, 2, 28))),
        (1900, 2, (D(1900, 2, 1), D(1900, 2, 28))),
        (2000, 2, (D(2000, 2, 1), D(2000, 2, 29))),
        (2024, 12, (D(2024, 12, 1), D(2024, 12, 31))),
        (2024, 4, (D(2024, 4, 1), D(2024, 4, 30))),
    ],
)
def test_month_span(year, month, expected):
    assert month_span(year, month) == expected


@pytest.mark.parametrize("month", [0, 13, -1])
def test_month_span_invalid(month):
    with pytest.raises(ValueError):
        month_span(2024, month)


def test_overlap_days():
    a = (D(2024, 1, 1), D(2024, 1, 10))
    assert overlap_days(a, (D(2024, 1, 5), D(2024, 1, 20))) == 6
    assert overlap_days(a, (D(2024, 1, 10), D(2024, 1, 12))) == 1
    assert overlap_days(a, (D(2024, 1, 11), D(2024, 1, 12))) == 0
    assert overlap_days(a, (D(2023, 1, 1), D(2023, 1, 2))) == 0
    assert overlap_days(a, (D(2024, 1, 3), D(2024, 1, 4))) == 2
    assert overlap_days((D(2024, 1, 5), D(2024, 1, 20)), a) == 6
