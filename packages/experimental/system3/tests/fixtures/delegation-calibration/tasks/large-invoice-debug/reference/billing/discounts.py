"""Per-product percentage discounts."""

from dataclasses import replace

from billing.lines import Line
from billing.money import percent_of


def apply_discounts(lines: list[Line], rules: dict[str, int]) -> list[Line]:
    """Return new lines with ``rules[description]`` percent taken off each unit price.

    Lines whose description has no rule keep their price. The input lines
    are not modified.
    """
    discounted = []
    for line in lines:
        percent = rules.get(line.description, 0)
        unit_cents = line.unit_cents - percent_of(line.unit_cents, percent)
        discounted.append(replace(line, unit_cents=unit_cents))
    return discounted
