"""In-memory stock store."""

from inventory.models import Item


class Store:
    """Holds items keyed by SKU and tracks quantity changes."""

    def __init__(self) -> None:
        self._items: dict[str, Item] = {}

    def add_item(self, item: Item) -> None:
        """Register ``item``; SKUs must be unique and quantities non-negative."""
        if item.sku in self._items:
            raise ValueError(f"duplicate sku: {item.sku}")
        if item.qty < 0:
            raise ValueError("qty must not be negative")
        self._items[item.sku] = item

    def get_item_by_sku(self, sku: str) -> Item:
        """Return the item for ``sku``; raise ``KeyError`` if unknown."""
        try:
            return self._items[sku]
        except KeyError:
            raise KeyError(sku) from None

    def add_qty(self, sku: str, n: int) -> int:
        """Increase stock of ``sku`` by ``n`` (> 0) and return the new qty."""
        if n <= 0:
            raise ValueError("n must be positive")
        item = self.get_item_by_sku(sku)
        item.qty += n
        return item.qty

    def remove_qty(self, sku: str, n: int) -> int:
        """Decrease stock of ``sku`` by ``n`` (> 0) and return the new qty."""
        if n <= 0:
            raise ValueError("n must be positive")
        item = self.get_item_by_sku(sku)
        if n > item.qty:
            raise ValueError(f"insufficient stock for {sku}")
        item.qty -= n
        return item.qty

    def all_items(self) -> list[Item]:
        """Return all items sorted by SKU."""
        return sorted(self._items.values(), key=lambda item: item.sku)
