import pytest
from inventory import Item, Store
from inventory.io import dump_store, load_store
from inventory.report import apply_plan, low_stock, render, restock_plan


@pytest.fixture
def store():
    s = Store()
    s.add_item(Item("B-2", "bolt", 40))
    s.add_item(Item("A-1", "anchor", 3))
    s.add_item(Item("C-3", "clamp", 0))
    return s


def test_quantity_changes(store):
    assert store.add_qty("A-1", 2) == 5
    assert store.remove_qty("B-2", 10) == 30
    with pytest.raises(ValueError):
        store.remove_qty("C-3", 1)
    with pytest.raises(KeyError):
        store.get_item_by_sku("Z-9")


def test_reports(store):
    assert low_stock(store, 5) == ["A-1", "C-3"]
    plan = restock_plan(store, {"A-1": 10, "B-2": 20})
    assert plan == {"A-1": 7}
    apply_plan(store, plan)
    assert store.get_item_by_sku("A-1").qty == 10
    assert render(store).splitlines()[0] == "A-1     anchor             10"


def test_round_trip(store, tmp_path):
    path = tmp_path / "stock.json"
    dump_store(store, path)
    loaded = load_store(path)
    assert [i.sku for i in loaded.all_items()] == ["A-1", "B-2", "C-3"]
    assert loaded.get_item_by_sku("B-2").qty == 40
