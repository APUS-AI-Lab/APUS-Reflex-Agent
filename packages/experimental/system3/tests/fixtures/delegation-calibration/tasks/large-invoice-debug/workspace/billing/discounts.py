"""Per-product percentage discounts."""

from billing.lines import Line
from billing.money import percent_of


def apply_discounts(lines: list[Line], rules: dict[str, int]) -> list[Line]:
    """Return ``lines`` with ``rules[description]`` percent taken off each unit price.

    Lines whose description has no rule keep their price.
    """
    for line in lines:
        percent = rules.get(line.description, 0)
        if percent:
            line.unit_cents -= percent_of(line.unit_cents, percent)
    return lines
