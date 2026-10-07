import pytest
from shop.pricing import apply_discount, line_total


@pytest.mark.parametrize(
    ("price", "percent", "expected"),
    [
        (100, 20, 80.0),
        (19.99, 0, 19.99),
        (50, 100, 0.0),
        (10, 15, 8.5),
        (9.99, 10, 8.99),
    ],
)
def test_apply_discount(price, percent, expected):
    assert apply_discount(price, percent) == expected


def test_line_total_uses_discounted_price():
    assert line_total(10, 3, 10) == 27.0
    assert line_total(4.5, 2) == 9.0


@pytest.mark.parametrize("percent", [-1, 100.5, 101])
def test_out_of_range_percent_rejected(percent):
    with pytest.raises(ValueError):
        apply_discount(10, percent)
