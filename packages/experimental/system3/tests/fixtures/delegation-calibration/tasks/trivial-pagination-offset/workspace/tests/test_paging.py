import pytest
from catalog.paging import page_count


def test_page_count_rounds_up():
    assert page_count(10, 3) == 4
    assert page_count(9, 3) == 3
    assert page_count(0, 5) == 0


def test_page_count_rejects_bad_page_size():
    with pytest.raises(ValueError):
        page_count(10, 0)
