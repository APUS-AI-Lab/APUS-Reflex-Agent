"""Plain-text invoice rendering."""

from billing.invoice import Invoice
from billing.money import format_cents


def render_invoice(invoice: Invoice) -> str:
    """Render one row per line at its list (pre-discount) price, then totals."""
    rows = [
        f"{line.description} x{line.qty} @ {format_cents(line.unit_cents)}"
        for line in invoice.lines
    ]
    summary = invoice.summary()
    rows.append(f"SUBTOTAL {summary['subtotal']}")
    rows.append(f"TAX {summary['tax']}")
    rows.append(f"TOTAL {summary['total']}")
    return "\n".join(rows)
