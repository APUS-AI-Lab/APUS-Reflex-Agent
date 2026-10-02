import pytest
from cachekit.lru import LRUCache


@pytest.mark.parametrize("capacity", [0, -1, 1.5, "3", None])
def test_invalid_capacity(capacity):
    with pytest.raises(ValueError):
        LRUCache(capacity)


def test_get_and_put():
    cache = LRUCache(2)
    assert cache.put("a", 1) is None
    assert cache.get("a") == 1
    assert cache.get("missing") is None
    assert cache.get("missing", 0) == 0


def test_put_evicts_least_recently_used():
    cache = LRUCache(2)
    cache.put("a", 1)
    cache.put("b", 2)
    assert cache.put("c", 3) == ("a", 1)
    assert "a" not in cache
    assert cache.keys() == ["b", "c"]


def test_get_refreshes_recency():
    cache = LRUCache(2)
    cache.put("a", 1)
    cache.put("b", 2)
    cache.get("a")
    assert cache.put("c", 3) == ("b", 2)
    assert cache.keys() == ["a", "c"]


def test_update_refreshes_recency_without_eviction():
    cache = LRUCache(2)
    cache.put("a", 1)
    cache.put("b", 2)
    assert cache.put("a", 10) is None
    assert len(cache) == 2
    assert cache.keys() == ["b", "a"]
    assert cache.put("c", 3) == ("b", 2)
    assert cache.peek("a") == 10


def test_peek_does_not_touch_order_or_stats():
    cache = LRUCache(2)
    cache.put("a", 1)
    cache.put("b", 2)
    assert cache.peek("a") == 1
    assert cache.peek("zzz", "d") == "d"
    assert cache.keys() == ["a", "b"]
    assert cache.stats() == {"hits": 0, "misses": 0, "evictions": 0}


def test_contains_does_not_touch_order_or_stats():
    cache = LRUCache(2)
    cache.put("a", 1)
    cache.put("b", 2)
    assert "a" in cache
    assert "x" not in cache
    assert cache.put("c", 3) == ("a", 1)
    assert cache.stats()["hits"] == 0
    assert cache.stats()["misses"] == 0


def test_pop():
    cache = LRUCache(3)
    cache.put("a", 1)
    cache.put("b", 2)
    assert cache.pop("a") == 1
    assert "a" not in cache
    assert cache.pop("a", "fallback") == "fallback"
    assert cache.pop("a", None) is None
    with pytest.raises(KeyError):
        cache.pop("a")
    assert len(cache) == 1
    assert cache.stats() == {"hits": 0, "misses": 0, "evictions": 0}


def test_stats_counts_hits_misses_evictions():
    cache = LRUCache(1)
    cache.get("a")
    cache.put("a", 1)
    cache.get("a")
    cache.get("a")
    cache.put("b", 2)
    cache.get("a")
    assert cache.stats() == {"hits": 2, "misses": 2, "evictions": 1}


def test_stats_returns_dict_snapshot():
    cache = LRUCache(1)
    snapshot = cache.stats()
    cache.get("x")
    assert snapshot == {"hits": 0, "misses": 0, "evictions": 0}
    assert cache.stats()["misses"] == 1


def test_resize_shrink_evicts_oldest_first():
    cache = LRUCache(4)
    for key in "abcd":
        cache.put(key, key.upper())
    cache.get("a")
    assert cache.resize(2) == [("b", "B"), ("c", "C")]
    assert cache.keys() == ["d", "a"]
    assert cache.stats()["evictions"] == 2
    assert cache.put("e", "E") == ("d", "D")
    assert cache.stats()["evictions"] == 3


def test_resize_grow():
    cache = LRUCache(1)
    cache.put("a", 1)
    assert cache.resize(3) == []
    assert cache.put("b", 2) is None
    assert cache.put("c", 3) is None
    assert len(cache) == 3


@pytest.mark.parametrize("capacity", [0, -2, 2.0])
def test_resize_validates_capacity(capacity):
    cache = LRUCache(2)
    cache.put("a", 1)
    with pytest.raises(ValueError):
        cache.resize(capacity)
    assert cache.keys() == ["a"]


def test_clear_keeps_stats():
    cache = LRUCache(1)
    cache.put("a", 1)
    cache.put("b", 2)
    cache.get("b")
    cache.get("a")
    cache.clear()
    assert len(cache) == 0
    assert cache.keys() == []
    assert cache.stats() == {"hits": 1, "misses": 1, "evictions": 1}
    assert cache.put("c", 3) is None


def test_keys_returns_list():
    cache = LRUCache(3)
    cache.put(1, "x")
    cache.put((2, 3), "y")
    keys = cache.keys()
    assert isinstance(keys, list)
    assert keys == [1, (2, 3)]
