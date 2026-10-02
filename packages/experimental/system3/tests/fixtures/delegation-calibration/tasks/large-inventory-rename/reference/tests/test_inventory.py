import pytest
from inventory import Item, Warehouse
from inventory.io import dump_warehouse, load_warehouse
from inventory.report import apply_plan, low_stock, render, restock_plan


@pytest.fixture
def warehouse():
    w = Warehouse()
    w.add_item(Item("B-2", "bolt", 40))
    w.add_item(Item("A-1", "anchor", 3))
    w.add_item(Item("C-3", "clamp", 0))
    return w


def test_quantity_changes(warehouse):
    assert warehouse.restock("A-1", 2) == 5
    assert warehouse.withdraw("B-2", 10) == 30
    with pytest.raises(ValueError):
        warehouse.withdraw("C-3", 1)
    with pytest.raises(KeyError):
        warehouse.find("Z-9")


def test_reports(warehouse):
    assert low_stock(warehouse, 5) == ["A-1", "C-3"]
    plan = restock_plan(warehouse, {"A-1": 10, "B-2": 20})
    assert plan == {"A-1": 7}
    apply_plan(warehouse, plan)
    assert warehouse.find("A-1").qty == 10
    assert render(warehouse).splitlines()[0] == "A-1     anchor             10"


def test_round_trip(warehouse, tmp_path):
    path = tmp_path / "stock.json"
    dump_warehouse(warehouse, path)
    loaded = load_warehouse(path)
    assert [i.sku for i in loaded.items()] == ["A-1", "B-2", "C-3"]
    assert loaded.find("B-2").qty == 40
