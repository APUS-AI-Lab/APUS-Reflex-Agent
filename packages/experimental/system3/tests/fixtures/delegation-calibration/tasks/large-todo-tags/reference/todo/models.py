"""Domain objects for the todo list."""

from dataclasses import dataclass, field


@dataclass
class Task:
    """A single todo item."""

    id: int
    title: str
    done: bool = False
    tags: list[str] = field(default_factory=list)
