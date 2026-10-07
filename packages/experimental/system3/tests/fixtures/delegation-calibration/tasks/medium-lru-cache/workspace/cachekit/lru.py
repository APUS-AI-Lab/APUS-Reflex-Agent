"""Least-recently-used cache with hit/miss statistics."""

from collections.abc import Hashable
from typing import Any


class LRUCache:
    """Bounded mapping that evicts the least recently used entry."""

    def __init__(self, capacity: int) -> None:
        raise NotImplementedError

    def get(self, key: Hashable, default: Any = None) -> Any:
        raise NotImplementedError

    def put(self, key: Hashable, value: Any) -> tuple[Hashable, Any] | None:
        raise NotImplementedError

    def peek(self, key: Hashable, default: Any = None) -> Any:
        raise NotImplementedError

    def pop(self, key: Hashable, *default: Any) -> Any:
        raise NotImplementedError

    def __len__(self) -> int:
        raise NotImplementedError

    def __contains__(self, key: object) -> bool:
        raise NotImplementedError

    def keys(self) -> list[Hashable]:
        raise NotImplementedError

    def resize(self, capacity: int) -> list[tuple[Hashable, Any]]:
        raise NotImplementedError

    def stats(self) -> dict[str, int]:
        raise NotImplementedError

    def clear(self) -> None:
        raise NotImplementedError
