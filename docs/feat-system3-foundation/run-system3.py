#!/usr/bin/env python3
"""Launch the source System3 profile with process-local gateway credentials."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time


FIDOO_HOST = os.environ.get("SYSTEM3_FIDOO_HOST", "").strip()
JEV_HOST = os.environ.get("SYSTEM3_JEV_HOST", "").strip()
JEV_SSH_PORT = os.environ.get("SYSTEM3_JEV_SSH_PORT", "").strip() or "22"
KEY_NAMES = ("SYSTEM3_LITELLM_API_KEY", "APUS_JEV_API_KEY")


# user@host or host; never an ssh option (a leading "-" would be parsed as one).
SSH_HOST_PATTERN = re.compile(r"^[A-Za-z0-9._@:\[\]]+(?:-[A-Za-z0-9._@:\[\]]+)*$")


def require_hosts() -> None:
    """Fail early when the SSH hosts are missing or could be read as ssh options."""
    for name, value in (
        ("SYSTEM3_FIDOO_HOST", FIDOO_HOST),
        ("SYSTEM3_JEV_HOST", JEV_HOST),
    ):
        if value and not SSH_HOST_PATTERN.match(value):
            raise SystemExit(
                f"{name} must look like user@host, got an unsupported value"
            )
    if not JEV_SSH_PORT.isdigit():
        raise SystemExit("SYSTEM3_JEV_SSH_PORT must be a port number")
    missing = [
        name
        for name, value in (
            ("SYSTEM3_FIDOO_HOST", FIDOO_HOST),
            ("SYSTEM3_JEV_HOST", JEV_HOST),
        )
        if not value
    ]
    if missing:
        raise SystemExit(
            "Set "
            + " and ".join(missing)
            + " (for example user@host) before running this launcher; "
            "SYSTEM3_JEV_SSH_PORT defaults to 22."
        )


def scrubbed_environment() -> dict[str, str]:
    """Keep gateway secrets out of SSH process environments."""
    return {
        name: value
        for name, value in os.environ.items()
        if not re.search(r"KEY|SECRET|TOKEN|PASSWORD", name, re.IGNORECASE)
    }


def ssh_arguments(host: str, port: str = "22") -> list[str]:
    """Use a foreground SSH process without sharing its lifecycle."""
    return [
        "ssh",
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=15",
        "-o",
        "ControlMaster=no",
        "-o",
        "ControlPath=none",
        "-p",
        port,
        host,
    ]


def remote_key(host: str, script: str, port: str = "22") -> str:
    """Capture a remote key without printing subprocess output on failure."""
    result = subprocess.run(
        [*ssh_arguments(host, port), "python3 -c " + shlex.quote(script)],
        capture_output=True,
        env=scrubbed_environment(),
        text=True,
        timeout=30,
        check=False,
    )
    value = result.stdout.strip()
    if result.returncode != 0 or not value or "\n" in value or "\r" in value:
        raise RuntimeError(f"Cannot read the gateway credential from {host}")
    return value


def read_credentials() -> tuple[str, str]:
    """Read only the existing named keys; never create a key or local key file."""
    fidoo_script = """from pathlib import Path
import ast
for line in Path('/home/xdan-litellm-server/.env.relays').read_text().splitlines():
    name, separator, value = line.partition('=')
    if separator and name.strip().removeprefix('export ') == 'GATEWAY_KEY_SYSTEM3_DSH':
        value = value.strip()
        if value and value[0] in (chr(34), chr(39)):
            value = ast.literal_eval(value)
        print(value)
        break
else:
    raise SystemExit(1)
"""
    jev_script = (
        "from pathlib import Path; "
        "print(Path('/root/.config/openjev/gateway.key').read_text().strip())"
    )
    require_hosts()
    return (
        remote_key(FIDOO_HOST, fidoo_script),
        remote_key(JEV_HOST, jev_script, JEV_SSH_PORT),
    )


def stop_process(process: subprocess.Popen[bytes] | None) -> None:
    """Terminate and join the owned process group before releasing its resources."""
    if process is None or process.poll() is not None:
        return
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait(timeout=5)


def start_tunnel() -> tuple[subprocess.Popen[bytes], int]:
    """Bind the Jev forward to a random loopback port and wait for readiness."""
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        port = reservation.getsockname()[1]
    arguments = ssh_arguments(JEV_HOST, JEV_SSH_PORT)
    process = subprocess.Popen(
        [
            *arguments[:-1],
            "-o",
            "ExitOnForwardFailure=yes",
            "-o",
            "ServerAliveInterval=15",
            "-o",
            "ServerAliveCountMax=2",
            "-N",
            "-L",
            f"127.0.0.1:{port}:127.0.0.1:30135",
            arguments[-1],
        ],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        env=scrubbed_environment(),
        start_new_session=True,
    )
    try:
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise RuntimeError("Jev SSH tunnel exited before listening")
            try:
                with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                    return process, port
            except OSError:
                time.sleep(0.1)
        raise RuntimeError("Jev SSH tunnel did not become ready")
    except BaseException:
        stop_process(process)
        raise


def temporary_overlay(repo: Path, destination: Path, port: int) -> None:
    """Relocate the source overlay without changing its privacy admission."""
    source = repo / "docs/feat-system3-foundation/system3-fidoo-runpod-tunnel.patch.yml"
    text = source.read_text()
    text = text.replace("http://127.0.0.1:30135", f"http://127.0.0.1:{port}")
    for package in ("apus-dsh-jev-plugin", "system3"):
        relative = f"../../packages/experimental/{package}/src/index.ts"
        absolute = repo / "packages/experimental" / package / "src/index.ts"
        text = text.replace(relative, json.dumps(str(absolute)))
    destination.write_text(text)
    destination.chmod(0o600)


def command(arguments: argparse.Namespace, overlay: str) -> list[str]:
    """Resolve the launch arguments without putting credentials in argv."""
    values = [
        "node",
        "--import",
        "tsx/esm",
        "apps/cli/src/bin.ts",
        "--profile",
        arguments.profile,
    ]
    manifest = arguments.dsh_home / "profiles" / arguments.profile / "package.json"
    if not manifest.exists():
        values.extend(["--from-default-profile", "headless"])
    values.extend(["--patch", overlay])
    for patch in arguments.patch:
        values.extend(["--patch", str(patch.resolve())])
    values.extend(arguments.task_args or ["Reply with exactly the word READY."])
    return values


def parse_arguments() -> argparse.Namespace:
    """Accept wrapper options before the dsh app arguments after --."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--repo-root", type=Path, default=Path(__file__).resolve().parents[2]
    )
    parser.add_argument(
        "--dsh-home",
        type=Path,
        help="Isolated home; defaults to REPO/.cache/system3-live",
    )
    parser.add_argument("--profile", default="system3-live")
    parser.add_argument(
        "--patch",
        type=Path,
        action="append",
        default=[],
        help="Additional overlay after the model-chain overlay",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the launch plan without SSH, credentials, or writes",
    )
    parser.add_argument(
        "task_args", nargs=argparse.REMAINDER, help="Headless app arguments, after --"
    )
    arguments = parser.parse_args()
    arguments.repo_root = arguments.repo_root.resolve()
    arguments.dsh_home = (
        arguments.dsh_home or arguments.repo_root / ".cache/system3-live"
    ).resolve()
    if arguments.task_args[:1] == ["--"]:
        arguments.task_args = arguments.task_args[1:]
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]*", arguments.profile):
        parser.error("--profile must be a simple profile name")
    return arguments


def main() -> int:
    """Run one task and clean up the owned tunnel and temporary overlay."""
    arguments = parse_arguments()
    if arguments.dry_run:
        print(
            json.dumps(
                {
                    "cwd": str(arguments.repo_root),
                    "dshHome": str(arguments.dsh_home),
                    "credentialReferences": KEY_NAMES,
                    "jevTunnel": "random loopback port -> RunPod 127.0.0.1:30135",
                    "command": command(arguments, "<temporary-overlay>"),
                },
                indent=2,
            )
        )
        return 0
    if not (arguments.repo_root / "apps/cli/src/bin.ts").is_file():
        raise RuntimeError("--repo-root does not contain the source dsh launcher")
    if shutil.which("ssh") is None or shutil.which("node") is None:
        raise RuntimeError("SSH and Node must be available on PATH")
    for patch in arguments.patch:
        if not patch.is_file():
            raise RuntimeError("An additional overlay does not exist")
    fidoo_key, jev_key = read_credentials()
    tunnel = None
    child = None
    try:
        tunnel, port = start_tunnel()
        arguments.dsh_home.mkdir(parents=True, exist_ok=True, mode=0o700)
        with tempfile.TemporaryDirectory(prefix="system3-overlay-") as directory:
            overlay = Path(directory) / "cordis.patch.yml"
            temporary_overlay(arguments.repo_root, overlay, port)
            environment = scrubbed_environment()
            environment.update(
                {
                    "DSH_HOME": str(arguments.dsh_home),
                    "DSH_TELEMETRY_DISABLED": "1",
                    KEY_NAMES[0]: fidoo_key,
                    KEY_NAMES[1]: jev_key,
                }
            )
            child = subprocess.Popen(
                command(arguments, str(overlay)),
                cwd=arguments.repo_root,
                env=environment,
                start_new_session=True,
            )
            return child.wait()
    finally:
        stop_process(child)
        stop_process(tunnel)


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, lambda _signal, _frame: sys.exit(143))
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
    except (OSError, RuntimeError, subprocess.TimeoutExpired) as error:
        print(f"System3 launcher failed: {error}", file=sys.stderr)
        sys.exit(1)
