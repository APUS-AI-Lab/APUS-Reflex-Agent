"""Todo list operations on top of the storage layer."""

from pathlib import Path

from todo.models import Task
from todo.storage import load_tasks, save_tasks


def add_task(store: str | Path, title: str) -> Task:
    """Append a new task and return it; ``title`` must not be blank."""
    title = title.strip()
    if not title:
        raise ValueError("title must not be empty")
    tasks = load_tasks(store)
    task = Task(id=max((t.id for t in tasks), default=0) + 1, title=title)
    tasks.append(task)
    save_tasks(store, tasks)
    return task


def list_tasks(store: str | Path, include_done: bool = True) -> list[Task]:
    """Return tasks in creation order, optionally hiding completed ones."""
    tasks = load_tasks(store)
    if not include_done:
        tasks = [t for t in tasks if not t.done]
    return tasks


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
    """Render one task as a list line, e.g. ``[x] 3 Buy milk``."""
    mark = "x" if task.done else " "
    return f"[{mark}] {task.id} {task.title}"
