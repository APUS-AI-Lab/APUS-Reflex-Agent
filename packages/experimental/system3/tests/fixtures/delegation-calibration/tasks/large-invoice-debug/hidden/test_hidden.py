import copy
import itertools

import pytest
from billing.discounts import apply_discounts
from billing.invoice import Invoice
from billing.lines import Line
from billing.render import render_invoice

RULES = {"pen": 10, "pad": 15}
EXPECTED = {"subtotal": 3199, "tax": 256, "total": 3455}
EXPECTED_SUMMARY = {"subtotal": "31.99", "tax": "2.56", "total": "34.55"}
EXPECTED_RENDER = "\n".join(
    [
        "pen x2 @ 10.00",
        "ink x1 @ 5.50",
        "pad x3 @ 3.33",
        "SUBTOTAL 31.99",
        "TAX 2.56",
        "TOTAL 34.55",
    ]
)


def make_lines():
    return [Line("pen", 1000, 2), Line("ink", 550), Line("pad", 333, 3)]


def make_invoice():
    return Invoice(make_lines(), dict(RULES), tax_percent=8)


def call(invoice, name):
    if name == "render":
        return render_invoice(invoice)
    if name == "summary":
        return invoice.summary()
    return getattr(invoice, name)()


def expected_for(name):
    if name == "render":
        return EXPECTED_RENDER
    if name == "summary":
        return EXPECTED_SUMMARY
    return EXPECTED[name]


def test_visible_failing_case():
    invoice = Invoice([Line("pen", 1000, 2)], {"pen": 10}, tax_percent=10)
    assert invoice.summary() == {"subtotal": "18.00", "tax": "1.80", "total": "19.80"}


@pytest.mark.parametrize("name", ["subtotal", "tax", "total", "summary", "render"])
def test_single_call_correct(name):
    assert call(make_invoice(), name) == expected_for(name)


@pytest.mark.parametrize(
    "order",
    list(itertools.permutations(["subtotal", "tax", "total", "summary", "render"])),
)
def test_any_call_order_is_consistent(order):
    invoice = make_invoice()
    for name in order + order:
        assert call(invoice, name) == expected_for(name), (order, name)


def test_repeated_calls_are_stable():
    invoice = make_invoice()
    for _ in range(5):
        assert invoice.total() == 3455
    assert render_invoice(invoice) == EXPECTED_RENDER
    assert render_invoice(invoice) == EXPECTED_RENDER


def test_render_shows_original_unit_prices_after_totals():
    invoice = make_invoice()
    invoice.total()
    invoice.summary()
    first_row = render_invoice(invoice).splitlines()[0]
    assert first_row == "pen x2 @ 10.00"


def test_apply_discounts_does_not_mutate_input():
    lines = make_lines()
    snapshot = copy.deepcopy(lines)
    ids = [id(line) for line in lines]
    result = apply_discounts(lines, RULES)
    assert lines == snapshot
    assert [id(line) for line in lines] == ids
    assert [line.unit_cents for line in result] == [900, 550, 283]
    assert [line.qty for line in result] == [2, 1, 3]
    assert [line.description for line in result] == ["pen", "ink", "pad"]


def test_apply_discounts_repeatable():
    lines = make_lines()
    first = apply_discounts(lines, RULES)
    second = apply_discounts(lines, RULES)
    assert first == second


def test_invoice_does_not_mutate_callers_lines():
    lines = make_lines()
    snapshot = copy.deepcopy(lines)
    invoice = Invoice(lines, dict(RULES), tax_percent=8)
    invoice.summary()
    invoice.total()
    render_invoice(invoice)
    assert lines == snapshot


def test_invoice_without_rules_and_tax():
    invoice = Invoice(make_lines())
    assert invoice.subtotal() == 2000 + 550 + 999
    assert invoice.tax() == 0
    assert invoice.total() == 3549
