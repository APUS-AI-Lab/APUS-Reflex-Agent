import json

import pytest
from todo.cli import main
from todo.core import add_task, list_tasks, tag_counts
from todo.models import Task


def run(capsys, store, *args):
    code = main(["--store", str(store), *args])
    out = capsys.readouterr()
    return code, out.out, out.err


@pytest.fixture
def store(tmp_path):
    return tmp_path / "todo.json"


def test_task_tags_default_empty():
    first = Task(id=1, title="x")
    second = Task(id=2, title="y")
    assert first.tags == []
    first.tags.append("a")
    assert second.tags == []


def test_add_with_tags_normalizes_and_dedups(store, capsys):
    code, out, _ = run(
        capsys,
        store,
        "add",
        "写周报",
        "--tag",
        " Work ",
        "--tag",
        "urgent",
        "--tag",
        "WORK",
    )
    assert (code, out) == (0, "added 1\n")
    assert run(capsys, store, "list")[1] == "[ ] 1 写周报 #work #urgent\n"


def test_tags_are_persisted_in_json(store, capsys):
    run(capsys, store, "add", "a", "--tag", "Home")
    run(capsys, store, "add", "b")
    data = json.loads(store.read_text(encoding="utf-8"))
    assert data["tasks"][0]["tags"] == ["home"]
    assert data["tasks"][1]["tags"] == []


def test_blank_tag_is_rejected_and_nothing_saved(store, capsys):
    run(capsys, store, "add", "keep me")
    code, out, err = run(capsys, store, "add", "bad", "--tag", "ok", "--tag", "  ")
    assert code == 1
    assert err.startswith("error:")
    assert out == ""
    assert run(capsys, store, "list")[1] == "[ ] 1 keep me\n"


def test_untagged_output_unchanged(store, capsys):
    run(capsys, store, "add", "plain")
    run(capsys, store, "add", "tagged", "--tag", "x")
    run(capsys, store, "done", "1")
    assert run(capsys, store, "list")[1] == "[x] 1 plain\n[ ] 2 tagged #x\n"


def test_list_filter_by_tag_case_insensitive(store, capsys):
    run(capsys, store, "add", "a", "--tag", "work")
    run(capsys, store, "add", "b", "--tag", "home")
    run(capsys, store, "add", "c", "--tag", "home", "--tag", "work")
    code, out, _ = run(capsys, store, "list", "--tag", "WORK")
    assert code == 0
    assert out == "[ ] 1 a #work\n[ ] 3 c #home #work\n"
    assert run(capsys, store, "list", "--tag", "none")[1] == ""


def test_list_tag_combined_with_pending(store, capsys):
    run(capsys, store, "add", "a", "--tag", "work")
    run(capsys, store, "add", "b", "--tag", "work")
    run(capsys, store, "add", "c")
    run(capsys, store, "done", "1")
    assert run(capsys, store, "list", "--tag", "work", "--pending")[1] == (
        "[ ] 2 b #work\n"
    )
    assert run(capsys, store, "list", "--pending")[1] == ("[ ] 2 b #work\n[ ] 3 c\n")


def test_tags_command(store, capsys):
    run(capsys, store, "add", "a", "--tag", "work", "--tag", "urgent")
    run(capsys, store, "add", "b", "--tag", "home")
    run(capsys, store, "add", "c", "--tag", "work")
    run(capsys, store, "done", "3")
    code, out, _ = run(capsys, store, "tags")
    assert code == 0
    assert out == "home 1\nurgent 1\nwork 2\n"


def test_tags_command_empty(store, capsys):
    assert run(capsys, store, "tags") == (0, "", "")
    run(capsys, store, "add", "no tags")
    assert run(capsys, store, "tags") == (0, "", "")


def test_legacy_file_without_tags(store, capsys):
    legacy = {
        "version": 1,
        "tasks": [
            {"id": 1, "title": "old", "done": True},
            {"id": 2, "title": "older", "done": False},
        ],
    }
    store.write_text(json.dumps(legacy), encoding="utf-8")
    assert run(capsys, store, "list")[1] == "[x] 1 old\n[ ] 2 older\n"
    assert run(capsys, store, "tags")[1] == ""
    run(capsys, store, "add", "new", "--tag", "t")
    assert run(capsys, store, "list", "--tag", "t")[1] == "[ ] 3 new #t\n"
    data = json.loads(store.read_text(encoding="utf-8"))
    assert [task["tags"] for task in data["tasks"]] == [[], [], ["t"]]


def test_core_api(store):
    task = add_task(store, "core", tags=["B", "a", "b"])
    assert task.tags == ["b", "a"]
    assert add_task(store, "untagged").tags == []
    assert [t.title for t in list_tasks(store, tag="a")] == ["core"]
    assert [t.title for t in list_tasks(store, include_done=True)] == [
        "core",
        "untagged",
    ]
    assert tag_counts(store) == {"a": 1, "b": 1}


def test_core_add_rejects_blank_tag(store):
    with pytest.raises(ValueError):
        add_task(store, "x", tags=[" "])
    assert list_tasks(store) == []


def test_existing_commands_still_work(store, capsys):
    assert run(capsys, store, "add", "a") == (0, "added 1\n", "")
    assert run(capsys, store, "done", "1")[1] == "completed 1\n"
    code, _, err = run(capsys, store, "done", "5")
    assert code == 1
    assert "no task 5" in err
