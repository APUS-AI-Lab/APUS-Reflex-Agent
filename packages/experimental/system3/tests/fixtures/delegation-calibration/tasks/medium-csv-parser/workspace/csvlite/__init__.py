"""A tiny CSV-like parser used by the import pipeline."""

from csvlite.parser import ParseError, parse, parse_line

__all__ = ["ParseError", "parse", "parse_line"]
