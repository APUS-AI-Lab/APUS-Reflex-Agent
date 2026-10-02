import pytest
from formatting.notify import format_message
from formatting.wrap import wrap


def test_line_exactly_width_fits():
    assert wrap("aaa bbb", 7) == ["aaa bbb"]
    assert wrap("aaa bbb ccc", 7) == ["aaa bbb", "ccc"]


def test_every_line_respects_width():
    text = "lorem ipsum dolor sit amet consectetur adipiscing elit sed do"
    for width in range(11, 30):
        lines = wrap(text, width)
        assert " ".join(lines) == text
        for line in lines:
            assert len(line) <= width
        for first, second in zip(lines, lines[1:]):
            assert len(first) + 1 + len(second.split()[0]) > width


def test_paragraphs_are_separated_by_one_empty_line():
    assert wrap("one two\n\nthree", 20) == ["one two", "", "three"]


def test_paragraphs_are_wrapped_independently():
    text = "aaa bbb ccc\n\nddd eee"
    assert wrap(text, 7) == ["aaa bbb", "ccc", "", "ddd eee"]


def test_multiple_blank_lines_produce_single_separator():
    assert wrap("one\n\n\n\ntwo", 20) == ["one", "", "two"]


def test_whitespace_only_blank_line_separates_paragraphs():
    assert wrap("one\n  \t \ntwo", 20) == ["one", "", "two"]


def test_leading_and_trailing_blank_lines_ignored():
    assert wrap("\n\none two\n\n", 20) == ["one two"]
    assert wrap("\n\n\n", 20) == []


def test_single_newline_is_whitespace():
    assert wrap("one\ntwo", 20) == ["one two"]


def test_existing_behaviour_preserved():
    assert wrap("a extraordinarily b", 5) == ["a", "extraordinarily", "b"]
    assert wrap("", 10) == []
    with pytest.raises(ValueError):
        wrap("text", 0)


def test_format_message_with_paragraphs():
    message = format_message("Hi", "aaa bbb\n\nccc", width=7)
    assert message == "HI\n==\naaa bbb\n\nccc"
