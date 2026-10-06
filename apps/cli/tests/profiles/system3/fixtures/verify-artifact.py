"""Independently verify the public System3 task's file effects."""

import csv
import json
import sys
from decimal import Decimal
from pathlib import Path


def verify(workspace: Path) -> None:
    """Compare the artifact with the immutable synthetic input and an external oracle."""
    source = Path(__file__).parent / "public-workspace" / "orders.csv"
    assert (workspace / "orders.csv").read_bytes() == source.read_bytes(), (
        "input changed"
    )
    with source.open(newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    amounts: dict[str, Decimal] = {}
    paid = 0
    for row in rows:
        if row["status"] == "paid":
            paid += 1
            amounts[row["region"]] = amounts.get(row["region"], Decimal(0)) + Decimal(
                row["amount"]
            )
    expected = {
        "currency": "USD",
        "paidOrders": paid,
        "excludedOrders": len(rows) - paid,
        "byRegion": {region: f"{value:.2f}" for region, value in amounts.items()},
        "total": f"{sum(amounts.values()):.2f}",
    }
    artifact = workspace / "artifacts" / "region-totals.json"
    assert json.loads(artifact.read_text(encoding="utf-8")) == expected, "totals differ"
    print(
        json.dumps(
            {"artifact": "artifacts/region-totals.json", "checks": 2, "passed": True}
        )
    )


if __name__ == "__main__":
    verify(Path(sys.argv[1]))
