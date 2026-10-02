"""JSON import and export of stock snapshots."""

import json
from dataclasses import asdict
from pathlib import Path

from inventory.models import Item
from inventory.warehouse import Warehouse


def load_warehouse(path: str | Path) -> Warehouse:
    """Build a warehouse from a JSON list of ``{sku, name, qty}`` objects."""
    warehouse = Warehouse()
    for row in json.loads(Path(path).read_text(encoding="utf-8")):
        warehouse.add_item(Item(sku=row["sku"], name=row["name"], qty=row["qty"]))
    return warehouse


def dump_warehouse(warehouse: Warehouse, path: str | Path) -> None:
    """Write all items of ``warehouse`` to ``path`` as a JSON list."""
    rows = [asdict(item) for item in warehouse.items()]
    Path(path).write_text(json.dumps(rows, indent=2) + "\n", encoding="utf-8")
