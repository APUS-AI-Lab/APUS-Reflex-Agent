import pytest
from formatting.notify import format_message
from formatting.wrap import wrap


def test_wraps_greedily():
    assert wrap("the quick brown fox", 10) == ["the quick", "brown fox"]


def test_long_word_gets_its_own_line():
    assert wrap("a extraordinarily b", 5) == ["a", "extraordinarily", "b"]


def test_empty_text():
    assert wrap("", 10) == []


def test_rejects_non_positive_width():
    with pytest.raises(ValueError):
        wrap("text", 0)


def test_format_message():
    message = format_message("Build", "the quick brown fox", width=10)
    assert message == "BUILD\n=====\nthe quick\nbrown fox"
