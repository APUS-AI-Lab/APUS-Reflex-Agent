"""Stock reports and replenishment planning."""

from inventory.store import Store


def low_stock(store: Store, threshold: int) -> list[str]:
    """Return SKUs whose quantity is below ``threshold``, sorted by SKU."""
    return [item.sku for item in store.all_items() if item.qty < threshold]


def restock_plan(store: Store, targets: dict[str, int]) -> dict[str, int]:
    """Return how many units each SKU needs to reach its target quantity."""
    plan = {}
    for sku, target in targets.items():
        shortfall = target - store.get_item_by_sku(sku).qty
        if shortfall > 0:
            plan[sku] = shortfall
    return plan


def apply_plan(store: Store, plan: dict[str, int]) -> None:
    """Restock every SKU in ``plan`` by the planned amount."""
    for sku, units in plan.items():
        store.add_qty(sku, units)


def render(store: Store) -> str:
    """Render a fixed-width stock table, one item per line."""
    return "\n".join(
        f"{item.sku:<8}{item.name:<16}{item.qty:>5}" for item in store.all_items()
    )
