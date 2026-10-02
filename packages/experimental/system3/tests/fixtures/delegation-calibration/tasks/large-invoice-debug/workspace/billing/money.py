"""Integer-cent money helpers."""

from decimal import ROUND_HALF_UP, Decimal


def to_cents(amount: str) -> int:
    """Parse a decimal string such as ``"12.34"`` into cents (half-up)."""
    cents = (Decimal(amount) * 100).quantize(Decimal(1), rounding=ROUND_HALF_UP)
    return int(cents)


def format_cents(cents: int) -> str:
    """Format cents as a plain decimal string, e.g. ``-50`` -> ``"-0.50"``."""
    sign = "-" if cents < 0 else ""
    whole, frac = divmod(abs(cents), 100)
    return f"{sign}{whole}.{frac:02d}"


def percent_of(cents: int, percent: int) -> int:
    """Return ``percent`` percent of ``cents``, rounded half-up to a cent."""
    value = Decimal(cents) * Decimal(percent) / 100
    return int(value.quantize(Decimal(1), rounding=ROUND_HALF_UP))
