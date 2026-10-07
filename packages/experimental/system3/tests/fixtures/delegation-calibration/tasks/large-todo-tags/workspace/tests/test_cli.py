from todo.cli import main


def run(capsys, store, *args):
    code = main(["--store", str(store), *args])
    out = capsys.readouterr()
    return code, out.out, out.err


def test_add_and_list(tmp_path, capsys):
    store = tmp_path / "todo.json"
    assert run(capsys, store, "add", "Buy milk") == (0, "added 1\n", "")
    assert run(capsys, store, "add", "Write report")[1] == "added 2\n"
    code, out, _ = run(capsys, store, "list")
    assert code == 0
    assert out == "[ ] 1 Buy milk\n[ ] 2 Write report\n"


def test_done_and_pending(tmp_path, capsys):
    store = tmp_path / "todo.json"
    run(capsys, store, "add", "a")
    run(capsys, store, "add", "b")
    assert run(capsys, store, "done", "1")[1] == "completed 1\n"
    assert run(capsys, store, "list")[1] == "[x] 1 a\n[ ] 2 b\n"
    assert run(capsys, store, "list", "--pending")[1] == "[ ] 2 b\n"


def test_errors(tmp_path, capsys):
    store = tmp_path / "todo.json"
    code, _, err = run(capsys, store, "done", "9")
    assert code == 1
    assert "no task 9" in err
    code, _, err = run(capsys, store, "add", "   ")
    assert code == 1
    assert err.startswith("error:")


def test_list_empty_store(tmp_path, capsys):
    assert run(capsys, tmp_path / "none.json", "list") == (0, "", "")
