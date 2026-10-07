"""JSON file persistence for tasks."""

import json
from dataclasses import asdict
from pathlib import Path

from todo.models import Task

FORMAT_VERSION = 1


def load_tasks(path: str | Path) -> list[Task]:
    """Read all tasks from ``path``; a missing file means an empty list."""
    file = Path(path)
    if not file.exists():
        return []
    data = json.loads(file.read_text(encoding="utf-8"))
    return [
        Task(id=item["id"], title=item["title"], done=item["done"])
        for item in data["tasks"]
    ]


def save_tasks(path: str | Path, tasks: list[Task]) -> None:
    """Write ``tasks`` to ``path``, replacing its contents."""
    payload = {"version": FORMAT_VERSION, "tasks": [asdict(t) for t in tasks]}
    text = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
    Path(path).write_text(text, encoding="utf-8")
