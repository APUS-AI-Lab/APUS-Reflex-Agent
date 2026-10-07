from billing.discounts import apply_discounts
from billing.invoice import Invoice
from billing.lines import Line
from billing.money import format_cents, percent_of, to_cents


def test_money_helpers():
    assert to_cents("12.345") == 1235
    assert to_cents("0.1") == 10
    assert format_cents(-50) == "-0.50"
    assert format_cents(123456) == "1234.56"
    assert percent_of(1999, 10) == 200


def test_discount_reduces_unit_price():
    lines = apply_discounts([Line("pen", 1000, 2), Line("ink", 500)], {"pen": 10})
    assert [line.unit_cents for line in lines] == [900, 500]


def test_invoice_without_discounts():
    invoice = Invoice([Line("pen", 1000, 2), Line("ink", 550)], tax_percent=10)
    assert invoice.subtotal() == 2550
    assert invoice.tax() == 255
    assert invoice.total() == 2805


def test_summary_consistent_with_discounts():
    invoice = Invoice([Line("pen", 1000, 2)], {"pen": 10}, tax_percent=10)
    assert invoice.summary() == {
        "subtotal": "18.00",
        "tax": "1.80",
        "total": "19.80",
    }
