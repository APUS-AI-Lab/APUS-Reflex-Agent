"""Invoice totals: discounted subtotal plus tax."""

from billing.discounts import apply_discounts
from billing.lines import Line
from billing.money import format_cents, percent_of


class Invoice:
    """An invoice over ``lines`` with optional discounts and a tax rate."""

    def __init__(
        self,
        lines: list[Line],
        discount_rules: dict[str, int] | None = None,
        tax_percent: int = 0,
    ) -> None:
        self.lines = lines
        self.discount_rules = discount_rules or {}
        self.tax_percent = tax_percent

    def subtotal(self) -> int:
        """Return the sum of discounted line amounts in cents."""
        discounted = apply_discounts(self.lines, self.discount_rules)
        return sum(line.amount() for line in discounted)

    def tax(self) -> int:
        """Return tax on the discounted subtotal in cents."""
        return percent_of(self.subtotal(), self.tax_percent)

    def total(self) -> int:
        """Return subtotal plus tax in cents."""
        return self.subtotal() + self.tax()

    def summary(self) -> dict[str, str]:
        """Return formatted subtotal, tax and total."""
        return {
            "subtotal": format_cents(self.subtotal()),
            "tax": format_cents(self.tax()),
            "total": format_cents(self.total()),
        }
