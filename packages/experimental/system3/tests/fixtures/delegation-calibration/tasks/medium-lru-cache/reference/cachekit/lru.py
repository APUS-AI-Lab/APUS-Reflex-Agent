"""Least-recently-used cache with hit/miss statistics."""

from collections import OrderedDict
from collections.abc import Hashable
from typing import Any


def _check_capacity(capacity: int) -> None:
    if not isinstance(capacity, int) or isinstance(capacity, bool) or capacity < 1:
        raise ValueError("capacity must be an int >= 1")


class LRUCache:
    """Bounded mapping that evicts the least recently used entry."""

    def __init__(self, capacity: int) -> None:
        _check_capacity(capacity)
        self._capacity = capacity
        self._data: OrderedDict[Hashable, Any] = OrderedDict()
        self._hits = 0
        self._misses = 0
        self._evictions = 0

    def get(self, key: Hashable, default: Any = None) -> Any:
        if key in self._data:
            self._hits += 1
            self._data.move_to_end(key)
            return self._data[key]
        self._misses += 1
        return default

    def put(self, key: Hashable, value: Any) -> tuple[Hashable, Any] | None:
        self._data[key] = value
        self._data.move_to_end(key)
        if len(self._data) > self._capacity:
            return self._evict_oldest()
        return None

    def peek(self, key: Hashable, default: Any = None) -> Any:
        return self._data.get(key, default)

    def pop(self, key: Hashable, *default: Any) -> Any:
        if len(default) > 1:
            raise TypeError("pop expected at most 2 arguments")
        if key in self._data:
            return self._data.pop(key)
        if default:
            return default[0]
        raise KeyError(key)

    def __len__(self) -> int:
        return len(self._data)

    def __contains__(self, key: object) -> bool:
        return key in self._data

    def keys(self) -> list[Hashable]:
        return list(self._data)

    def resize(self, capacity: int) -> list[tuple[Hashable, Any]]:
        _check_capacity(capacity)
        self._capacity = capacity
        evicted = []
        while len(self._data) > capacity:
            evicted.append(self._evict_oldest())
        return evicted

    def stats(self) -> dict[str, int]:
        return {
            "hits": self._hits,
            "misses": self._misses,
            "evictions": self._evictions,
        }

    def clear(self) -> None:
        self._data.clear()

    def _evict_oldest(self) -> tuple[Hashable, Any]:
        self._evictions += 1
        return self._data.popitem(last=False)
