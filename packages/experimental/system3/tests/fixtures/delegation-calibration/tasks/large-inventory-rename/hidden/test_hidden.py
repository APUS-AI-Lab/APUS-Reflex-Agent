import json
import warnings

import inventory
import pytest
from inventory import io as inventory_io
from inventory import report
from inventory.models import Item
from inventory.warehouse import Warehouse

OLD_METHODS = ("get_item_by_sku", "add_qty", "remove_qty", "all_items")


def make_warehouse():
    w = Warehouse()
    w.add_item(Item("B-2", "bolt", 40))
    w.add_item(Item("A-1", "anchor", 3))
    w.add_item(Item("C-3", "clamp", 0))
    return w


@pytest.fixture(autouse=True)
def deprecations_are_errors():
    with warnings.catch_warnings():
        warnings.simplefilter("error", DeprecationWarning)
        yield


def test_warehouse_methods():
    w = make_warehouse()
    assert w.find("A-1") == Item("A-1", "anchor", 3)
    assert w.restock("A-1", 2) == 5
    assert w.withdraw("B-2", 10) == 30
    assert w.withdraw("B-2", 30) == 0
    assert [item.sku for item in w.items()] == ["A-1", "B-2", "C-3"]


def test_warehouse_errors():
    w = make_warehouse()
    with pytest.raises(KeyError):
        w.find("Z-9")
    with pytest.raises(KeyError):
        w.restock("Z-9", 1)
    for bad in (0, -1):
        with pytest.raises(ValueError):
            w.restock("A-1", bad)
        with pytest.raises(ValueError):
            w.withdraw("A-1", bad)
    with pytest.raises(ValueError):
        w.withdraw("A-1", 4)
    assert w.find("A-1").qty == 3
    with pytest.raises(ValueError):
        w.add_item(Item("A-1", "dup", 1))
    with pytest.raises(ValueError):
        w.add_item(Item("N-1", "negative", -1))


def test_warehouse_has_no_old_method_names():
    for name in OLD_METHODS:
        assert not hasattr(Warehouse, name), name


def test_report_functions_accept_warehouse():
    w = make_warehouse()
    assert report.low_stock(w, 5) == ["A-1", "C-3"]
    plan = report.restock_plan(w, {"A-1": 10, "B-2": 20, "C-3": 1})
    assert plan == {"A-1": 7, "C-3": 1}
    report.apply_plan(w, plan)
    assert w.find("A-1").qty == 10
    assert w.find("C-3").qty == 1
    expected = "\n".join(
        f"{sku:<8}{name:<16}{qty:>5}"
        for sku, name, qty in [
            ("A-1", "anchor", 10),
            ("B-2", "bolt", 40),
            ("C-3", "clamp", 1),
        ]
    )
    assert report.render(w) == expected


def test_io_round_trip_returns_warehouse(tmp_path):
    path = tmp_path / "stock.json"
    inventory_io.dump_warehouse(make_warehouse(), path)
    rows = json.loads(path.read_text(encoding="utf-8"))
    assert rows == [
        {"sku": "A-1", "name": "anchor", "qty": 3},
        {"sku": "B-2", "name": "bolt", "qty": 40},
        {"sku": "C-3", "name": "clamp", "qty": 0},
    ]
    loaded = inventory_io.load_warehouse(path)
    assert type(loaded) is Warehouse
    assert loaded.find("B-2").qty == 40


def test_load_existing_file_format(tmp_path):
    path = tmp_path / "legacy.json"
    path.write_text(
        json.dumps([{"sku": "X-1", "name": "nut", "qty": 7}]), encoding="utf-8"
    )
    loaded = inventory_io.load_warehouse(path)
    assert loaded.items() == [Item("X-1", "nut", 7)]


def test_io_old_names_removed():
    assert not hasattr(inventory_io, "load_store")
    assert not hasattr(inventory_io, "dump_store")


def test_package_exports():
    from inventory.store import Store

    assert inventory.Warehouse is Warehouse
    assert inventory.Item is Item
    assert inventory.Store is Store


def test_store_shim_warns_on_instantiation():
    from inventory.store import Store

    with pytest.deprecated_call():
        store = Store()
    assert isinstance(store, Warehouse)


def test_store_shim_supports_old_and_new_names():
    from inventory.store import Store

    with pytest.deprecated_call():
        store = Store()
    store.add_item(Item("A-1", "anchor", 3))
    assert store.add_qty("A-1", 2) == 5
    assert store.restock("A-1", 1) == 6
    assert store.remove_qty("A-1", 1) == 5
    assert store.withdraw("A-1", 1) == 4
    assert store.get_item_by_sku("A-1") is store.find("A-1")
    assert store.all_items() == store.items() == [Item("A-1", "anchor", 4)]
    with pytest.raises(KeyError):
        store.get_item_by_sku("missing")
    with pytest.raises(ValueError):
        store.remove_qty("A-1", 99)


def test_report_still_accepts_store_shim():
    from inventory.store import Store

    with pytest.deprecated_call():
        store = Store()
    store.add_item(Item("A-1", "anchor", 1))
    assert report.low_stock(store, 5) == ["A-1"]
