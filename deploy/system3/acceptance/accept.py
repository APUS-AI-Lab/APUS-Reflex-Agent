"""Public browser acceptance of the System3 deployment, run as a person would use it.

Each scenario types into the deployed site through the gstack browse binary, then checks what the person sees
(dock text, terminal cards) and what the Session log records. Usage:

    python3 deploy/system3/acceptance/accept.py [scenario ...]

Requires: the `prd` SSH alias for the deployment host, the browse binary (``BROWSE``), and a launch URL that the
script reads from the service log when the browser is signed out. It never prints the launch token.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path

SITE = os.environ.get("SYSTEM3_SITE", "https://system3.xdan.work/")
HOST = os.environ.get("SYSTEM3_HOST", "prd")
WORKSPACE = "/var/lib/xdan-system3/workspace"
SESSIONS = "/var/lib/xdan-system3/home/.dsh/sessions"
BROWSE = os.environ.get(
    "BROWSE", str(Path.home() / ".claude/skills/gstack/browse/dist/browse")
)
OUT = Path(os.environ.get("ACCEPT_OUT") or tempfile.mkdtemp(prefix="system3-accept-"))
LAUNCH_URL_FILE = Path.home() / ".config/xdan-system3/public-launch-url"
FIXTURES = Path(__file__).parent / "fixtures"
TURN_ENDED = ("Turn ended", "本轮已结束", "Ready", "准备就绪")


def host(command: str, data: bytes | None = None) -> str:
    """Run one command on the deployment host and return its output."""
    # Without data, -n gives ssh an empty stdin so a background run cannot hang on it.
    flags = (
        ["-o", "BatchMode=yes"] if data is not None else ["-n", "-o", "BatchMode=yes"]
    )
    result = subprocess.run(
        ["ssh", *flags, HOST, command], input=data, capture_output=True, check=False
    )
    return result.stdout.decode()


class Browser:
    """The acceptance browser, driven one command at a time."""

    def __init__(self) -> None:
        self.env = {**os.environ, "BROWSE_STATE_FILE": str(OUT / "browse.json")}

    def run(self, *args: str) -> str:
        """Run one browse command and return its output."""
        return subprocess.run(
            [BROWSE, *args], env=self.env, capture_output=True, text=True, check=False
        ).stdout

    def js(self, expression: str) -> str:
        """Evaluate JavaScript in the page and return the last output line."""
        lines = self.run("js", expression).strip().splitlines()
        return lines[-1] if lines else ""

    def dock(self) -> str:
        """The System3 dock text, one line per row joined with ' | '."""
        return self.js(
            "(document.querySelector('section[aria-label=System3]')?.innerText ?? '').replace(/\\n+/g, ' | ')"
        )

    def ref(self, pattern: str) -> str | None:
        """The interactive element reference whose snapshot line matches the pattern."""
        for line in self.run("snapshot", "-i").splitlines():
            if re.search(pattern, line):
                found = re.search(r"@e\d+", line)
                if found:
                    return found.group(0)
        return None

    def click(self, pattern: str) -> bool:
        """Click the element matching the pattern; one click per snapshot keeps references fresh."""
        reference = self.ref(pattern)
        if reference is None:
            return False
        self.run("click", reference)
        time.sleep(1.5)
        return True

    def type_and_send(self, text: str) -> None:
        """Focus the composer, type the text, and press Enter."""
        focused = self.js(
            "(() => { const el = [...document.querySelectorAll('[aria-label]')]"
            ".find(e => /^(Describe what|Message or run)/.test(e.getAttribute('aria-label'))); el?.focus(); return el ? 'ok' : 'none' })()"
        )
        if focused != "ok":
            raise RuntimeError("composer not found")
        self.run("type", text)
        self.run("press", "Enter")

    def screenshot(self, name: str) -> None:
        """Save a screenshot into the output directory."""
        self.run("screenshot", str(OUT / f"{name}.png"))

    def sign_in(self) -> str:
        """Open the site, signing in through the latest launch URL when needed; returns the deployed version label."""
        self.run("goto", SITE)
        time.sleep(6)
        # js() returns only the last output line, so the page answers the question itself.
        if (
            self.js(
                "document.body.innerText.includes('authentication required') ? 'out' : 'in'"
            )
            == "out"
        ):
            token = re.findall(
                r"\?token=[A-Za-z0-9_-]+",
                host("journalctl -u xdan-system3 -n 2000 --no-pager -o cat"),
            )
            if not token:
                raise RuntimeError("no launch token in the service log")
            LAUNCH_URL_FILE.parent.mkdir(parents=True, exist_ok=True)
            LAUNCH_URL_FILE.write_text(SITE + token[-1] + "\n")
            LAUNCH_URL_FILE.chmod(0o600)
            self.run("goto", LAUNCH_URL_FILE.read_text().strip())
            time.sleep(6)
        return self.js("document.body.innerText.match(/0\\.1\\.7[^\\n]*/)?.[0] ?? ''")

    def new_session(self) -> None:
        """Start a new session from the sidebar."""
        if not self.click(r'"New session"'):
            raise RuntimeError("no New session button")
        time.sleep(2)

    def send(self, text: str, timeout: int = 240) -> float:
        """Send one message and wait until the turn ends; returns the seconds waited."""
        started = time.time()
        self.type_and_send(text)
        # The dock reads Ready until the turn starts, so wait for it to leave that state first.
        while time.time() - started < 30 and self.dock().startswith(TURN_ENDED):
            time.sleep(1)
        while time.time() - started < timeout:
            if self.dock().startswith(TURN_ENDED):
                break
            time.sleep(4)
        return time.time() - started

    def expand_commands(self) -> None:
        """Open the turn's steps and every collapsed command group, one click per snapshot."""
        self.click(r'"Took \d+s"')
        for _ in range(6):
            lines = [
                line
                for line in self.run("snapshot", "-i").splitlines()
                if re.search(r'\[button\] "Ran commands', line)
            ]
            closed = next((line for line in lines if "[expanded]" not in line), None)
            if closed is None:
                return
            found = re.search(r"@e\d+", closed)
            if found is None:
                return
            self.run("click", found.group(0))
            time.sleep(1.5)

    def answer_question(self) -> bool:
        """Choose the first option of a pending question card and submit it."""
        if not self.click(r"\[radio\]"):
            return False
        return self.click(r'\[button\] "Submit"')


def latest_events() -> list[dict]:
    """The events of the most recently written Session on the host."""
    raw = host(
        f'f=$(ls -t {SESSIONS}/*/session-*/session.v4.jsonl.zstd | head -1); zstd -dc "$f" 2>/dev/null'
    )
    events = []
    for line in raw.splitlines():
        try:
            events.append(json.loads(line))
        except ValueError:
            continue
    return events


def of(events: list[dict], kind: str) -> list[dict]:
    """The data of every event of one type."""
    return [event.get("data", {}) for event in events if event.get("type") == kind]


def texts(message: dict) -> str:
    """The text blocks of a message joined."""
    return "".join(
        block.get("text", "")
        for block in message.get("content", [])
        if block.get("type") == "text"
    )


def cards_seen(events: list[dict]) -> list[str]:
    """Runtime-context snapshots that carried the task frame to the model."""
    return [
        texts(data)
        for data in of(events, "user/message")
        if data.get("source", {}).get("kind") == "runtime-context"
        and "[System3 任务卡]" in texts(data)
    ]


def commands(events: list[dict]) -> list[str]:
    """The shell commands the model ran, in order."""
    found = []
    for data in of(events, "tool/call"):
        arguments = data.get("arguments")
        if isinstance(arguments, str):
            try:
                arguments = json.loads(arguments)
            except ValueError:
                arguments = {}
        if data.get("name") == "bash" and isinstance(arguments, dict):
            found.append(str(arguments.get("command", "")))
    return found


def commands_after(events: list[dict], needle: str) -> list[str]:
    """The shell commands run after the person's message containing the needle reached the model."""
    seen = False
    later = []
    for event in events:
        data = event.get("data", {})
        if (
            event.get("type") == "user/message"
            and data.get("source", {}).get("kind") == "user"
            and needle in texts(data)
        ):
            seen = True
        elif seen and event.get("type") == "tool/call":
            later.extend(commands([event]))
    return later


def goal_phase(events: list[dict]) -> str | None:
    """The phase of the latest goal change, or its operation for a clear."""
    changes = of(events, "goal/change")
    if not changes:
        return None
    last = changes[-1]
    return (last.get("goal") or {}).get("phase") or last.get("operation")


@dataclass
class Result:
    """Named checks of one scenario."""

    name: str
    checks: list[tuple[str, bool, str]] = field(default_factory=list)

    def check(self, label: str, ok: bool, detail: str = "") -> None:
        """Record one check."""
        self.checks.append((label, ok, detail))

    @property
    def passed(self) -> bool:
        """Whether every check passed."""
        return bool(self.checks) and all(ok for _, ok, _ in self.checks)


def routing(browser: Browser) -> Result:
    """Entry routing sends a translation to Flash and a reasoning question to a stronger model."""
    result = Result("routing")
    browser.new_session()
    browser.send("把 have a nice weekend 翻译成中文", 120)
    browser.send("解释一下为什么二分查找要求数组有序，用几步推理说明", 180)
    events = latest_events()
    decisions = of(events, "system3/entry-decision")
    answers = [
        data["message"].get("source", {}).get("model")
        for data in of(events, "assistant/message")
        if texts(data["message"]).strip()
    ]
    result.check(
        "two entry decisions recorded",
        len(decisions) >= 2,
        str([d.get("outcome") for d in decisions]),
    )
    result.check(
        "the translation is answered by deepseek-flash",
        bool(answers) and answers[0] == "deepseek-flash",
        str(answers),
    )
    result.check(
        "the reasoning question is answered by a stronger model",
        len(answers) >= 2 and answers[-1] != "deepseek-flash",
        str(answers),
    )
    return result


def folding(browser: Browser) -> Result:
    """A failing unittest run is folded losslessly and the model still finds the shared cause."""
    result = Result("folding")
    host(f"install -d -o xdan-system3 -g xdan-system3 {WORKSPACE}/fold-check")
    host(
        f"install -o xdan-system3 -g xdan-system3 -m 644 /dev/stdin {WORKSPACE}/fold-check/test_render_unit.py",
        (FIXTURES / "test_render_unit.py").read_bytes(),
    )
    browser.new_session()
    browser.send(
        "在 fold-check 目录里运行 python3 -m unittest -v test_render_unit，告诉我为什么失败，先不要修改代码",
        240,
    )
    events = latest_events()
    folds = of(events, "system3/output-fold")
    result.check(
        "the unittest output was folded and applied",
        any(f.get("applied") and f.get("foldedLines", 0) > 0 for f in folds),
        str(folds),
    )
    browser.expand_commands()
    browser.click(r'\[button\] "(Failed )?Bash [^"]*([Uu]nit|[Tt]est)')
    marker = browser.js(
        "(() => { const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n;"
        " while ((n = w.nextNode())) { if (n.textContent.includes('System3 已折叠') && n.parentElement.tagName === 'DIV') {"
        " n.parentElement.scrollIntoView({ block: 'center' }); return n.textContent.trim() } } return '' })()"
    )
    browser.screenshot("folding-card")
    result.check(
        "the terminal card shows a marker that quotes the repeated first line",
        "开头是" in marker,
        marker[:120],
    )
    final = [
        texts(d["message"])
        for d in of(events, "assistant/message")
        if texts(d["message"]).strip()
    ]
    result.check(
        "the model names the shared cause (role at index 3)",
        bool(final) and "role" in final[-1],
        final[-1][:120] if final else "",
    )
    host(f"rm -rf {WORKSPACE}/fold-check")
    return result


def task_frame(browser: Browser) -> Result:
    """A requirement is kept verbatim, shown in the dock, given to the model, and dropped when the task changes."""
    result = Result("task-frame")
    browser.new_session()
    browser.send(
        "帮我写一个 Python 函数，把一组 (日期, 金额) 记录按月汇总金额，直接在回答里给出代码，不用建文件",
        150,
    )
    browser.send("函数名统一用 snake_case，而且不要用任何第三方库，只用标准库", 150)
    time.sleep(6)
    dock = browser.dock()
    result.check(
        "the dock shows one kept requirement",
        bool(re.search(r"(任务卡 · 已记下 1 条要求|requirements kept: 1)", dock)),
        dock[:160],
    )
    browser.send("再写一个按年汇总的函数，和上面的放在一起", 150)
    browser.screenshot("task-frame-card")
    events = latest_events()
    result.check(
        "the model received the task card",
        any("snake_case" in card for card in cards_seen(events)),
        str(len(cards_seen(events))),
    )
    browser.send("对了，帮我查一下明天北京的天气", 150)
    time.sleep(8)
    dock = browser.dock()
    result.check(
        "the task card leaves the dock after a switch",
        "任务卡" not in dock and "Task card" not in dock,
        dock[:160],
    )
    frames = of(latest_events(), "system3/task-frame")
    result.check(
        "a new frame starts from the switch",
        bool(frames)
        and "天气" in frames[-1]["goal"]["text"]
        and not frames[-1]["items"],
        frames[-1]["goal"]["text"][:40] if frames else "",
    )
    return result


def goal_interrupt(browser: Browser) -> Result:
    """A /goal round takes an interruption into the running turn and still completes the goal."""
    result = Result("goal-interrupt")
    host(f"rm -rf {WORKSPACE}/goal-check")
    browser.new_session()
    browser.type_and_send(
        "/goal 在 goal-check 目录里写一个 Python 模块 ledger.py，提供按月汇总金额的函数，并用 unittest 写测试，运行 python3 -m unittest 全部通过才算完成"
    )
    time.sleep(8)
    browser.type_and_send(
        "等一下，先别运行测试，先把测试文件改名为 check_ledger.py，然后再跑"
    )
    line = ""
    for _ in range(30):
        time.sleep(2)
        if re.search(
            r"(插入正在进行的这一轮|added to the running turn)", browser.dock()
        ):
            line = browser.dock()
            browser.screenshot("goal-interrupt-dock")
            break
    result.check(
        "the dock reports the requirement added to the running turn",
        bool(line),
        line[:160],
    )
    for _ in range(60):
        events = latest_events()
        if goal_phase(events) in ("complete", "blocked", "clear"):
            break
        browser.answer_question()
        time.sleep(15)
    events = latest_events()
    interjections = of(events, "system3/interjection")
    result.check(
        "the interruption moved into the running turn",
        any(i.get("delivered") for i in interjections),
        str(interjections),
    )
    # The model may run tests before the interruption arrives; what matters is the order after it reads the message.
    ran = commands_after(events, "先别运行测试")
    rename = next(
        (
            i
            for i, c in enumerate(ran)
            if "check_ledger" in c and ("mv " in c or "git mv" in c)
        ),
        None,
    )
    first_test = next((i for i, c in enumerate(ran) if "unittest" in c), None)
    result.check(
        "after reading the interruption, the model renamed the test file before running tests",
        rename is not None and (first_test is None or rename < first_test),
        f"rename={rename} first_test={first_test}",
    )
    result.check(
        "the goal completed", goal_phase(events) == "complete", str(goal_phase(events))
    )
    files = host(f"ls -1 {WORKSPACE}/goal-check 2>/dev/null").split()
    result.check(
        "the workspace holds check_ledger.py", "check_ledger.py" in files, str(files)
    )
    browser.screenshot("goal-interrupt-end")
    host(f"rm -rf {WORKSPACE}/goal-check")
    return result


def codex_forward(browser: Browser) -> Result:
    """A requirement typed while Codex runs reaches Codex, and Codex's result follows it."""
    result = Result("codex-forward")
    host(f"rm -rf {WORKSPACE}/goal-check")
    browser.new_session()
    browser.type_and_send(
        "交给 codex：在 goal-check 目录里写一个 Python 模块 ledger.py，提供按月汇总金额的函数，并用 unittest 写测试，跑通后告诉我结果"
    )
    running = False
    for _ in range(90):
        time.sleep(2)
        if re.search(r"codex (运行中|running)", browser.dock(), re.IGNORECASE):
            running = True
            break
    result.check("the dock shows Codex running", running)
    browser.type_and_send("测试文件命名为 check_ledger.py")
    forwarded = ""
    for _ in range(20):
        time.sleep(2)
        dock = browser.dock()
        if re.search(r"(已补充|Added at)", dock):
            forwarded = dock
            browser.screenshot("codex-forward-dock")
            break
    result.check(
        "the Codex card lists the forwarded requirement",
        "check_ledger" in forwarded,
        forwarded[:200],
    )
    for _ in range(60):
        time.sleep(10)
        if browser.dock().startswith(TURN_ENDED):
            break
    events = latest_events()
    result.check(
        "system3/interjection records the forward to codex",
        any(
            i.get("forwardedTo") == "codex" for i in of(events, "system3/interjection")
        ),
        str(of(events, "system3/interjection")),
    )
    result.check(
        "subagent/steer carries the text",
        any("check_ledger" in s.get("text", "") for s in of(events, "subagent/steer")),
    )
    files = host(f"ls -1 {WORKSPACE}/goal-check 2>/dev/null").split()
    result.check(
        "Codex produced check_ledger.py", "check_ledger.py" in files, str(files)
    )
    browser.screenshot("codex-forward-end")
    host(f"rm -rf {WORKSPACE}/goal-check")
    return result


SCENARIOS = {
    "routing": routing,
    "folding": folding,
    "task-frame": task_frame,
    "goal-interrupt": goal_interrupt,
    "codex-forward": codex_forward,
}


def main(names: list[str]) -> int:
    """Run the named scenarios, or all of them, and print one line per check."""
    unknown = [name for name in names if name not in SCENARIOS]
    if unknown:
        print(f"unknown scenarios: {unknown}; choose from {list(SCENARIOS)}")
        return 2
    browser = Browser()
    print(f"site version: {browser.sign_in()} | screenshots: {OUT}")
    failed = 0
    for name in names or list(SCENARIOS):
        started = time.time()
        try:
            result = SCENARIOS[name](browser)
        except (
            Exception
        ) as error:  # A broken scenario is reported and the rest still run.
            result = Result(name)
            result.check("scenario ran", False, repr(error))
        print(
            f"\n== {name}: {'PASS' if result.passed else 'FAIL'} ({time.time() - started:.0f}s)"
        )
        for label, ok, detail in result.checks:
            print(
                f"  {'ok ' if ok else 'BAD'} {label}"
                + (f"  [{detail}]" if detail and not ok else "")
            )
        failed += 0 if result.passed else 1
    host(f"rm -rf {WORKSPACE}/goal-check {WORKSPACE}/fold-check")
    leftover = host(f"ls -A {WORKSPACE}").split()
    print(f"\nworkspace after cleanup: {leftover or 'empty'}")
    print(f"{len(names or SCENARIOS) - failed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
