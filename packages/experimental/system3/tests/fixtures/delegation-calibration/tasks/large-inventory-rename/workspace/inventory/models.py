"""Inventory data objects."""

from dataclasses import dataclass


@dataclass
class Item:
    """A stock-keeping unit and its on-hand quantity."""

    sku: str
    name: str
    qty: int = 0
