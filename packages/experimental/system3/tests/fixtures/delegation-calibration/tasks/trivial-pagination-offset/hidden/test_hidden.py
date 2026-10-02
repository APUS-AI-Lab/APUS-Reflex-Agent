import pytest
from catalog.paging import page_count, page_slice

ITEMS = list(range(10))


def test_first_page():
    assert page_slice(ITEMS, 1, 3) == [0, 1, 2]


def test_middle_page():
    assert page_slice(ITEMS, 2, 3) == [3, 4, 5]


def test_last_page_may_be_partial():
    assert page_slice(ITEMS, 4, 3) == [9]


def test_page_past_end_is_empty():
    assert page_slice(ITEMS, 5, 3) == []
    assert page_slice([], 1, 3) == []


def test_returns_list_for_tuple_input():
    assert page_slice(tuple("abcde"), 1, 2) == ["a", "b"]


def test_all_pages_cover_items_exactly_once():
    pages = [page_slice(ITEMS, p, 4) for p in range(1, page_count(10, 4) + 1)]
    assert [x for page in pages for x in page] == ITEMS


@pytest.mark.parametrize(("page", "per_page"), [(0, 3), (-1, 3), (1, 0)])
def test_invalid_arguments(page, per_page):
    with pytest.raises(ValueError):
        page_slice(ITEMS, page, per_page)
