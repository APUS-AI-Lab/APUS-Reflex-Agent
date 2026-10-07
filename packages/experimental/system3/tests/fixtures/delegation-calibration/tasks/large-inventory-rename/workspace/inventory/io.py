"""JSON import and export of stock snapshots."""

import json
from dataclasses import asdict
from pathlib import Path

from inventory.models import Item
from inventory.store import Store


def load_store(path: str | Path) -> Store:
    """Build a store from a JSON list of ``{sku, name, qty}`` objects."""
    store = Store()
    for row in json.loads(Path(path).read_text(encoding="utf-8")):
        store.add_item(Item(sku=row["sku"], name=row["name"], qty=row["qty"]))
    return store


def dump_store(store: Store, path: str | Path) -> None:
    """Write all items of ``store`` to ``path`` as a JSON list."""
    rows = [asdict(item) for item in store.all_items()]
    Path(path).write_text(json.dumps(rows, indent=2) + "\n", encoding="utf-8")
