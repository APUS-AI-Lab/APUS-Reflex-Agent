"""Invoice line items."""

from dataclasses import dataclass


@dataclass
class Line:
    """One product line: a unit price in cents times a quantity."""

    description: str
    unit_cents: int
    qty: int = 1

    def amount(self) -> int:
        """Return the line amount in cents."""
        return self.unit_cents * self.qty
