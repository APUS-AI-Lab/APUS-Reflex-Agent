"""HTTP surface for driving this harness from another process.

An evaluator runs outside this container and needs to hand work in and read
results back over the network. The harness already speaks JSON-RPC to its own
child process, but that transport is stdio and assumes a local parent; this
module wraps the same SDK in a small HTTP server so the harness can be a
long-lived service that other containers address by URL.

Only the standard library is used: the SDK's dependency list is pydantic and
the runtime binary, and a web framework for four routes would be a new
platform choice this package does not otherwise make.

@module deepseek_harness.service
"""

from __future__ import annotations

import json
import os
import threading
import uuid
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from .api import DeepSeekHarness, DeepSeekHarnessConfig


@dataclass
class _Run:
    """One task the evaluator handed in, and what it has produced so far."""

    run_id: str
    task_id: str
    instruction: str
    session_id: str
    result: dict[str, Any] | None = None
    error: str | None = None
    done: threading.Event = field(default_factory=threading.Event)


class HarnessService:
    """Drives the harness over HTTP for an external evaluator.

    One harness instance is kept alive across runs: starting it is the expensive
    part, and a per-request process would pay that cost every time. Runs are
    isolated by session id and by their own working directory.
    """

    def __init__(self, config: DeepSeekHarnessConfig) -> None:
        self._config = config
        self._harness: DeepSeekHarness | None = None
        self._runs: dict[str, _Run] = {}
        self._lock = threading.Lock()

    def _ensure_started(self) -> DeepSeekHarness:
        if self._harness is None:
            self._harness = DeepSeekHarness(self._config)
        self._harness.start()
        return self._harness

    def start_run(self, task: dict[str, Any]) -> str:
        """Accept one task and begin executing it on a worker thread.

        The evaluator polls `/v1/runs/<id>` rather than holding a connection
        open: a task can run for hours, and an idle HTTP connection would be
        dropped long before it finished.
        """
        instruction = task.get("instruction")
        if not isinstance(instruction, str) or not instruction:
            raise ValueError("task.instruction must be a nonempty string")
        run_id = uuid.uuid4().hex
        run = _Run(
            run_id=run_id,
            task_id=str(task.get("task_id") or ""),
            instruction=instruction,
            session_id=f"session-{run_id}",
        )
        with self._lock:
            self._runs[run_id] = run

        def execute() -> None:
            try:
                harness = self._ensure_started()
                result = harness.run(instruction, session_id=run.session_id)
                run.result = {
                    "final_response": result.final_response,
                    "finish_reason": result.finish_reason,
                    "session_id": result.session_id,
                    "events": result.events,
                    "notifications": [
                        {"method": n.method, "payload": n.payload}
                        for n in result.notifications
                    ],
                }
            except Exception as error:  # every failure must reach the caller
                run.error = f"{type(error).__name__}: {error}"
            finally:
                run.done.set()

        threading.Thread(target=execute, name=f"run-{run_id}", daemon=True).start()
        return run_id

    def run_state(self, run_id: str) -> dict[str, Any] | None:
        with self._lock:
            run = self._runs.get(run_id)
        if run is None:
            return None
        if not run.done.is_set():
            return {"run_id": run.run_id, "status": "running"}
        if run.error is not None:
            return {"run_id": run.run_id, "status": "failed", "error": run.error}
        return {"run_id": run.run_id, "status": "completed", **(run.result or {})}

    def cancel(self, run_id: str) -> bool:
        """Mark a run cancelled. The harness finishes its current turn first."""
        with self._lock:
            run = self._runs.get(run_id)
        if run is None:
            return False
        run.error = run.error or "cancelled"
        run.done.set()
        return True


def config_from_environment() -> DeepSeekHarnessConfig:
    """Read the harness configuration this deployment launched with.

    The values are required: a service that starts without a model route would
    accept work and fail every task, which is harder to diagnose than refusing
    to start.
    """

    def required(name: str) -> str:
        value = os.environ.get(name, "").strip()
        if not value:
            raise RuntimeError(f"dsh service requires {name} in the environment")
        return value

    def optional(name: str) -> str | None:
        value = os.environ.get(name, "").strip()
        return value or None

    raw_patches = os.environ.get("DSH_PATCHES", "")
    patches = tuple(p.strip() for p in raw_patches.split(":") if p.strip())
    return DeepSeekHarnessConfig(
        provider=required("LLM_PROVIDER"),
        model=required("LLM_MODEL"),
        dsh_bin=optional("DSH_BIN"),
        profile=optional("DSH_PROFILE") or "sdk",
        patches=patches,
        dsh_home=optional("DSH_HOME"),
        base_url=required("LLM_BASE_URL"),
        api_key=required("LLM_API_KEY"),
        initialize_timeout_seconds=float(os.environ.get("DSH_INITIALIZE_TIMEOUT", "300")),
    )


def _handler(service: HarnessService) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, format: str, *args: Any) -> None:
            print(f"dsh-service: {format % args}", flush=True)

        def _reply(self, status: int, body: dict[str, Any]) -> None:
            payload = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def _body(self) -> dict[str, Any]:
            length = int(self.headers.get("content-length") or 0)
            if length <= 0:
                return {}
            parsed = json.loads(self.rfile.read(length))
            if not isinstance(parsed, dict):
                raise ValueError("request body must be a JSON object")
            return parsed

        def do_GET(self) -> None:  # noqa: N802 - name fixed by BaseHTTPRequestHandler
            if self.path == "/healthz":
                self._reply(200, {"status": "ok"})
                return
            if self.path.startswith("/v1/runs/"):
                run_id = self.path.rsplit("/", 1)[-1]
                state = service.run_state(run_id)
                if state is None:
                    self._reply(404, {"error": {"message": "run not found"}})
                    return
                self._reply(200, state)
                return
            self._reply(404, {"error": {"message": f"no route for {self.path}"}})

        def do_POST(self) -> None:  # noqa: N802 - name fixed by BaseHTTPRequestHandler
            try:
                if self.path == "/v1/runs":
                    body = self._body()
                    task = body.get("task")
                    if not isinstance(task, dict):
                        raise ValueError("missing task object")
                    run_id = service.start_run(task)
                    self._reply(200, {"run_id": run_id})
                    return
                if self.path.startswith("/v1/runs/") and self.path.endswith("/cancel"):
                    run_id = self.path.split("/")[3]
                    if not service.cancel(run_id):
                        self._reply(404, {"error": {"message": "run not found"}})
                        return
                    self._reply(200, {"run_id": run_id, "status": "cancelled"})
                    return
                self._reply(404, {"error": {"message": f"no route for {self.path}"}})
            except ValueError as error:
                self._reply(400, {"error": {"message": str(error)}})
            except json.JSONDecodeError as error:
                self._reply(400, {"error": {"message": f"invalid JSON: {error}"}})

    return Handler


def serve(host: str, port: int) -> None:
    """Run the harness service until the process is stopped."""
    service = HarnessService(config_from_environment())
    server = ThreadingHTTPServer((host, port), _handler(service))
    print(f"dsh-service: listening on {host}:{port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8080)
    args = parser.parse_args()
    serve(args.host, args.port)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
