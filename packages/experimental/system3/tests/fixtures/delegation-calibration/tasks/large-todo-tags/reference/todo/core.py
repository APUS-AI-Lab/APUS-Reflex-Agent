"""Todo list operations on top of the storage layer."""

from collections import Counter
from collections.abc import Iterable
from pathlib import Path

from todo.models import Task
from todo.storage import load_tasks, save_tasks


def normalize_tag(tag: str) -> str:
    """Return ``tag`` stripped and lower-cased; reject blank tags."""
    normalized = tag.strip().lower()
    if not normalized:
        raise ValueError("tag must not be empty")
    return normalized


def normalize_tags(tags: Iterable[str]) -> list[str]:
    """Normalize ``tags`` and drop duplicates, keeping first occurrences."""
    return list(dict.fromkeys(normalize_tag(tag) for tag in tags))


def add_task(store: str | Path, title: str, tags: Iterable[str] | None = None) -> Task:
    """Append a new task and return it; ``title`` and tags must not be blank."""
    title = title.strip()
    if not title:
        raise ValueError("title must not be empty")
    clean_tags = normalize_tags(tags or [])
    tasks = load_tasks(store)
    task = Task(
        id=max((t.id for t in tasks), default=0) + 1,
        title=title,
        tags=clean_tags,
    )
    tasks.append(task)
    save_tasks(store, tasks)
    return task


def list_tasks(
    store: str | Path, include_done: bool = True, tag: str | None = None
) -> list[Task]:
    """Return tasks in creation order, filtered by completion and tag."""
    tasks = load_tasks(store)
    if not include_done:
        tasks = [t for t in tasks if not t.done]
    if tag is not None:
        wanted = normalize_tag(tag)
        tasks = [t for t in tasks if wanted in t.tags]
    return tasks


def tag_counts(store: str | Path) -> dict[str, int]:
    """Return how many tasks (done or not) carry each tag."""
    counts = Counter(tag for task in load_tasks(store) for tag in task.tags)
    return dict(sorted(counts.items()))


def complete_task(store: str | Path, task_id: int) -> Task:
    """Mark ``task_id`` done; raise ``KeyError`` if it does not exist."""
    tasks = load_tasks(store)
    for task in tasks:
        if task.id == task_id:
            task.done = True
            save_tasks(store, tasks)
            return task
    raise KeyError(task_id)


def format_task(task: Task) -> str:
    """Render one task as a list line, e.g. ``[x] 3 Buy milk #home``."""
    mark = "x" if task.done else " "
    line = f"[{mark}] {task.id} {task.title}"
    return "".join([line, *(f" #{tag}" for tag in task.tags)])
