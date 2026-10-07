import pytest
from textkit.slug import slugify


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Hello, World!", "hello-world"),
        ("Café Déjà Vu", "cafe-deja-vu"),
        ("  Multiple   spaces__and--dashes  ", "multiple-spaces-and-dashes"),
        ("Python 3.12 发布了", "python-3-12"),
        ("--already-slugged--", "already-slugged"),
        ("ÀÉÎÕÜ ñ", "aeiou-n"),
        ("MiXeD CaSe", "mixed-case"),
    ],
)
def test_basic_rules(text, expected):
    assert slugify(text) == expected


@pytest.mark.parametrize("text", ["", "!!!", "   ", "中文标题", "___"])
def test_empty_result_becomes_untitled(text):
    assert slugify(text) == "untitled"


def test_default_max_length_is_50():
    result = slugify("a" * 60)
    assert result == "a" * 50


def test_truncation_strips_trailing_hyphen():
    assert slugify("abc def", max_length=4) == "abc"
    assert slugify("abc def ghi", max_length=8) == "abc-def"


def test_truncation_exact():
    assert slugify("abcdef", max_length=3) == "abc"
    assert slugify("abc", max_length=3) == "abc"


def test_result_only_contains_allowed_characters():
    result = slugify("Ünïcödé & Symbols: @#$%^*() — done")
    assert result == "unicode-symbols-done"


@pytest.mark.parametrize("max_length", [0, -5])
def test_invalid_max_length(max_length):
    with pytest.raises(ValueError):
        slugify("anything", max_length=max_length)
