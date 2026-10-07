"""Command-line entry point: ``python -m todo [--store PATH] <command>``."""

import argparse
import sys

from todo.core import add_task, complete_task, format_task, list_tasks, tag_counts


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="todo")
    parser.add_argument("--store", default="todo.json", help="JSON data file")
    commands = parser.add_subparsers(dest="command", required=True)

    add = commands.add_parser("add", help="add a task")
    add.add_argument("title")
    add.add_argument(
        "--tag", action="append", default=[], dest="tags", help="tag (repeatable)"
    )

    show = commands.add_parser("list", help="list tasks")
    show.add_argument("--pending", action="store_true", help="hide done tasks")
    show.add_argument("--tag", help="only tasks with this tag")

    done = commands.add_parser("done", help="mark a task as done")
    done.add_argument("task_id", type=int)

    commands.add_parser("tags", help="show tag usage counts")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "add":
        try:
            task = add_task(args.store, args.title, args.tags)
        except ValueError as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 1
        print(f"added {task.id}")
    elif args.command == "list":
        try:
            tasks = list_tasks(args.store, include_done=not args.pending, tag=args.tag)
        except ValueError as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 1
        for task in tasks:
            print(format_task(task))
    elif args.command == "done":
        try:
            complete_task(args.store, args.task_id)
        except KeyError:
            print(f"error: no task {args.task_id}", file=sys.stderr)
            return 1
        print(f"completed {args.task_id}")
    elif args.command == "tags":
        for tag, count in tag_counts(args.store).items():
            print(f"{tag} {count}")
    return 0
