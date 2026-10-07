"""Deprecated compatibility layer; use :mod:`inventory.warehouse` instead."""

import warnings

from inventory.models import Item
from inventory.warehouse import Warehouse


class Store(Warehouse):
    """Deprecated alias of :class:`Warehouse` that keeps the old method names."""

    def __init__(self) -> None:
        warnings.warn(
            "inventory.store.Store is deprecated; use inventory.warehouse.Warehouse",
            DeprecationWarning,
            stacklevel=2,
        )
        super().__init__()

    def get_item_by_sku(self, sku: str) -> Item:
        """Deprecated name of :meth:`Warehouse.find`."""
        return self.find(sku)

    def add_qty(self, sku: str, n: int) -> int:
        """Deprecated name of :meth:`Warehouse.restock`."""
        return self.restock(sku, n)

    def remove_qty(self, sku: str, n: int) -> int:
        """Deprecated name of :meth:`Warehouse.withdraw`."""
        return self.withdraw(sku, n)

    def all_items(self) -> list[Item]:
        """Deprecated name of :meth:`Warehouse.items`."""
        return self.items()
