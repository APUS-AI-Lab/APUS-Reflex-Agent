"""Stock reports and replenishment planning."""

from inventory.warehouse import Warehouse


def low_stock(warehouse: Warehouse, threshold: int) -> list[str]:
    """Return SKUs whose quantity is below ``threshold``, sorted by SKU."""
    return [item.sku for item in warehouse.items() if item.qty < threshold]


def restock_plan(warehouse: Warehouse, targets: dict[str, int]) -> dict[str, int]:
    """Return how many units each SKU needs to reach its target quantity."""
    plan = {}
    for sku, target in targets.items():
        shortfall = target - warehouse.find(sku).qty
        if shortfall > 0:
            plan[sku] = shortfall
    return plan


def apply_plan(warehouse: Warehouse, plan: dict[str, int]) -> None:
    """Restock every SKU in ``plan`` by the planned amount."""
    for sku, units in plan.items():
        warehouse.restock(sku, units)


def render(warehouse: Warehouse) -> str:
    """Render a fixed-width stock table, one item per line."""
    return "\n".join(
        f"{item.sku:<8}{item.name:<16}{item.qty:>5}" for item in warehouse.items()
    )
