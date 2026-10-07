"""CSV-like record parsing without the stdlib ``csv`` module."""

_FIELD_START = "field_start"
_UNQUOTED = "unquoted"
_QUOTED = "quoted"
_AFTER_QUOTE = "after_quote"


class ParseError(ValueError):
    """Raised when the input violates the format rules."""


def parse_line(line: str, delimiter: str = ",") -> list[str]:
    """Parse a single record into its fields."""
    records = _scan(line, delimiter, allow_newlines=False)
    return records[0] if records else [""]


def parse(
    text: str, delimiter: str = ",", header: bool = True
) -> list[list[str]] | list[dict[str, str]]:
    """Parse ``text`` into records, optionally keyed by a header row."""
    records = _scan(text, delimiter, allow_newlines=True)
    if not header:
        return records
    if not records:
        return []
    columns, rows = records[0], records[1:]
    if len(set(columns)) != len(columns):
        raise ParseError("duplicate column name in header")
    result = []
    for number, row in enumerate(rows, start=2):
        if len(row) != len(columns):
            raise ParseError(
                f"record {number} has {len(row)} fields, expected {len(columns)}"
            )
        result.append(dict(zip(columns, row)))
    return result


def _check_delimiter(delimiter: str) -> None:
    if len(delimiter) != 1 or delimiter in '"\r\n':
        raise ValueError(f"invalid delimiter: {delimiter!r}")


def _scan(text: str, delimiter: str, allow_newlines: bool) -> list[list[str]]:
    _check_delimiter(delimiter)
    records: list[list[str]] = []
    row: list[str] = []
    buf: list[str] = []
    state = _FIELD_START

    def end_record() -> None:
        nonlocal row, buf, state
        if state != _FIELD_START or row:
            row.append("".join(buf))
            records.append(row)
        row, buf, state = [], [], _FIELD_START

    i = 0
    while i < len(text):
        ch = text[i]
        if state == _QUOTED:
            if ch == '"':
                if text.startswith('"', i + 1):
                    buf.append('"')
                    i += 1
                else:
                    state = _AFTER_QUOTE
            else:
                buf.append(ch)
        elif ch == delimiter:
            row.append("".join(buf))
            buf, state = [], _FIELD_START
        elif ch == "\n" or (ch == "\r" and text.startswith("\n", i + 1)):
            if not allow_newlines:
                raise ParseError("newline outside quotes in a single record")
            if ch == "\r":
                i += 1
            end_record()
        elif ch == '"':
            if state != _FIELD_START:
                raise ParseError(f"unexpected quote at offset {i}")
            state = _QUOTED
        else:
            if state == _AFTER_QUOTE:
                raise ParseError(f"unexpected character after quote at offset {i}")
            buf.append(ch)
            state = _UNQUOTED
        i += 1

    if state == _QUOTED:
        raise ParseError("unterminated quoted field")
    end_record()
    return records
