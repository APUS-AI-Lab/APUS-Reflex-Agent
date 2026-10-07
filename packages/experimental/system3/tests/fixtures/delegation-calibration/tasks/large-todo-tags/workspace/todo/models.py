"""Domain objects for the todo list."""

from dataclasses import dataclass


@dataclass
class Task:
    """A single todo item."""

    id: int
    title: str
    done: bool = False
