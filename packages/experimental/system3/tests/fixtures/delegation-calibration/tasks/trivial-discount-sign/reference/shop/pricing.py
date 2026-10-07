"""Price calculations used by the checkout page."""


def apply_discount(price: float, percent: float) -> float:
    """Return ``price`` reduced by ``percent`` percent, rounded to 2 decimals."""
    if not 0 <= percent <= 100:
        raise ValueError("percent must be between 0 and 100")
    return round(price - price * percent / 100, 2)


def line_total(price: float, qty: int, percent: float = 0) -> float:
    """Return the discounted total for ``qty`` units of ``price``."""
    return round(apply_discount(price, percent) * qty, 2)
