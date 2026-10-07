import pytest
from csvlite.parser import ParseError, parse, parse_line


def test_parse_error_is_value_error():
    assert issubclass(ParseError, ValueError)


@pytest.mark.parametrize(
    ("line", "expected"),
    [
        ("a,b,c", ["a", "b", "c"]),
        ("a,,b", ["a", "", "b"]),
        ("a,", ["a", ""]),
        (",", ["", ""]),
        ("", [""]),
        (" a , b ", [" a ", " b "]),
        ('"x,y","say ""hi"""', ["x,y", 'say "hi"']),
        ('""', [""]),
        ('"",x', ["", "x"]),
        ('"multi\nline",z', ["multi\nline", "z"]),
        ('"a""b"', ['a"b']),
    ],
)
def test_parse_line(line, expected):
    assert parse_line(line) == expected


def test_parse_line_custom_delimiter():
    assert parse_line('a;"b;c";d', delimiter=";") == ["a", "b;c", "d"]
    assert parse_line("a,b;c", delimiter=";") == ["a,b", "c"]
    assert parse_line("a\tb", delimiter="\t") == ["a", "b"]


@pytest.mark.parametrize(
    "line",
    ['"a"b,c', '"unterminated', 'a"b', 'x,"y', '"a" ,b', "a\nb", "a\r\nb"],
)
def test_parse_line_errors(line):
    with pytest.raises(ParseError):
        parse_line(line)


@pytest.mark.parametrize("delimiter", ["", ";;", '"', "\n", "\r"])
def test_invalid_delimiter(delimiter):
    with pytest.raises(ValueError):
        parse_line("a", delimiter=delimiter)
    with pytest.raises(ValueError):
        parse("a", delimiter=delimiter)


def test_parse_without_header():
    text = "a,b\n1,2\n"
    assert parse(text, header=False) == [["a", "b"], ["1", "2"]]


def test_parse_with_header():
    text = "name,age\nalice,30\nbob,25"
    assert parse(text) == [
        {"name": "alice", "age": "30"},
        {"name": "bob", "age": "25"},
    ]


def test_crlf_line_endings():
    assert parse("a,b\r\n1,2\r\n", header=False) == [["a", "b"], ["1", "2"]]


def test_newlines_inside_quotes_are_preserved():
    text = 'id,note\n1,"line one\nline two"\n2,"crlf\r\nkept"\n'
    assert parse(text) == [
        {"id": "1", "note": "line one\nline two"},
        {"id": "2", "note": "crlf\r\nkept"},
    ]


def test_blank_lines_are_skipped():
    text = "\na,b\n\n\n1,2\n\n"
    assert parse(text, header=False) == [["a", "b"], ["1", "2"]]


def test_quoted_empty_line_is_not_blank():
    assert parse('x\n""\n', header=False) == [["x"], [""]]


def test_empty_text():
    assert parse("") == []
    assert parse("", header=False) == []
    assert parse("\n\n", header=False) == []


def test_header_only():
    assert parse("a,b,c\n") == []


def test_field_count_mismatch():
    with pytest.raises(ParseError):
        parse("a,b\n1,2,3\n")
    with pytest.raises(ParseError):
        parse("a,b\n1\n")


def test_mismatch_allowed_without_header():
    assert parse("a,b\n1\n", header=False) == [["a", "b"], ["1"]]


def test_duplicate_header():
    with pytest.raises(ParseError):
        parse("a,b,a\n1,2,3\n")


def test_parse_errors_propagate():
    with pytest.raises(ParseError):
        parse('a,b\n"open,1\n')
    with pytest.raises(ParseError):
        parse('a,b\n"x"y,1\n')


def test_parse_custom_delimiter():
    assert parse('k;v\n1;"a;b"\n', delimiter=";") == [{"k": "1", "v": "a;b"}]
