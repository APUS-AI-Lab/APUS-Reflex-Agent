"""CSV-like record parsing without the stdlib ``csv`` module."""


class ParseError(ValueError):
    """Raised when the input violates the format rules."""


def parse_line(line: str, delimiter: str = ",") -> list[str]:
    """Parse a single record into its fields."""
    raise NotImplementedError


def parse(
    text: str, delimiter: str = ",", header: bool = True
) -> list[list[str]] | list[dict[str, str]]:
    """Parse ``text`` into records, optionally keyed by a header row."""
    raise NotImplementedError
