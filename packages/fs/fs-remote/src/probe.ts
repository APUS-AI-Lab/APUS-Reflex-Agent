/** Python filesystem operations executed in the task container. @module @deepseek-ai/dsh-fs-remote/probe */

export interface ProbeRequest {
  op: 'resolve' | 'stat' | 'lstat' | 'read' | 'list' | 'write' | 'edit' | 'bytes' | 'range'
  path: string
  /** Working directory a relative path resolves against. */
  cwd?: string
  /** Full replacement text, for `write`. */
  content?: string
  /** Literal edit, for `edit`. */
  old?: string
  new?: string
  replaceAll?: boolean
  /** Byte budget, for `bytes`. */
  maxBytes?: number
  /** Byte window, for `range`. */
  offset?: number
  length?: number
  /** Expected version, for a guarded write or edit. */
  expectedVersion?: string
  /** Whether `write` may only create. */
  createOnly?: boolean
  policy?: { mode: 'read-only' | 'workspace-write' | 'danger-full-access'; workspaceRoot: string }
}

/** What the probe answered. */
export interface ProbeAnswer {
  ok?: boolean
  code?: string
  message?: string
  version?: string
  type?: 'file' | 'directory' | 'symlink' | 'other'
  size?: number
  text?: string
  base64?: string
  entries?: Array<{ name: string; path: string; type: 'file' | 'directory' | 'other'; version: string; size?: number }>
  operation?: 'create' | 'update'
  before?: string | null
  after?: string
  /** Canonical path the probe resolved. */
  path?: string
  /** Whether the target exists, for resolve/stat/lstat. */
  exists?: boolean
}

/** One JSON request and one JSON result; guarded mutations share a canonical-path lock. */
export const PROBE_SOURCE = String.raw`
import base64, contextlib, errno, fcntl, hashlib, json, os, secrets, stat, sys, tempfile

def version(p, follow=True):
    st = os.stat(p, follow_symlinks=follow)
    return version_of(st)

def version_of(st):
    return "%d:%d:%d:%d" % (st.st_dev, st.st_ino, st.st_mtime_ns, st.st_size)

def kind(p, follow=True):
    st = os.stat(p, follow_symlinks=follow)
    if stat.S_ISLNK(st.st_mode):
        return "symlink"
    if stat.S_ISDIR(st.st_mode):
        return "directory"
    if stat.S_ISREG(st.st_mode):
        return "file"
    return "other"

def need(p):
    if not os.path.exists(p):
        fail("FS_NOT_FOUND", "not found: " + p)
    return p

def regular(p):
    need(p)
    if not stat.S_ISREG(os.stat(p).st_mode):
        fail("FS_NOT_REGULAR_FILE", "not a regular file: " + p)

def fail(code, message):
    print(json.dumps({"ok": False, "code": code, "message": message}))
    sys.exit(0)

@contextlib.contextmanager
def mutation_lock(path):
    directory = os.path.join(tempfile.gettempdir(), "dsh-fs-remote-" + str(os.getuid()))
    os.makedirs(directory, mode=0o700, exist_ok=True)
    st = os.lstat(directory)
    if not stat.S_ISDIR(st.st_mode) or st.st_uid != os.getuid() or stat.S_IMODE(st.st_mode) != 0o700:
        fail("FS_PERMISSION_DENIED", "unsafe mutation lock directory")
    name = hashlib.sha256(path.encode("utf-8")).hexdigest()
    fd = os.open(os.path.join(directory, name), os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        yield
    finally:
        os.close(fd)

@contextlib.contextmanager
def mutation_directory(path):
    fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY)
    try:
        for component in os.path.dirname(path).split("/"):
            if not component:
                continue
            try:
                next_fd = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            except FileNotFoundError:
                try:
                    os.mkdir(component, dir_fd=fd)
                except FileExistsError:
                    pass
                next_fd = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = next_fd
        yield fd
    except OSError as error:
        if error.errno in (errno.ELOOP, errno.ENOTDIR):
            fail("FS_SANDBOX_DENIED", "mutation ancestor changed or is not a directory")
        raise
    finally:
        os.close(fd)

def atomic_publish(directory_fd, name, content, create_only, mode):
    pending = ".dsh-fs-" + secrets.token_hex(16)
    fd = os.open(pending, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=directory_fd)
    try:
        with os.fdopen(fd, "wb") as f:
            if mode is not None:
                os.fchmod(f.fileno(), mode)
            f.write(content.encode("utf-8"))
            f.flush()
            os.fsync(f.fileno())
        if create_only:
            try:
                os.link(pending, name, src_dir_fd=directory_fd, dst_dir_fd=directory_fd, follow_symlinks=False)
            except FileExistsError:
                fail("FS_NOT_OBSERVED", "file already exists: " + name)
        else:
            os.replace(pending, name, src_dir_fd=directory_fd, dst_dir_fd=directory_fd)
    finally:
        try:
            os.unlink(pending, dir_fd=directory_fd)
        except FileNotFoundError:
            pass

def checked_mutation_path(path, policy):
    canonical = os.path.realpath(path)
    if policy is None:
        return canonical
    mode = policy["mode"]
    if mode == "danger-full-access":
        return canonical
    if mode == "read-only":
        fail("FS_SANDBOX_DENIED", "writes are denied under read-only mode")
    if mode != "workspace-write":
        fail("FS_SANDBOX_DENIED", "unknown file access mode")
    root = os.path.realpath(policy["workspaceRoot"])
    if os.path.commonpath([root, canonical]) != root:
        fail("FS_SANDBOX_DENIED", "path is outside the writable workspace")
    return canonical

def normalized(text):
    return text.replace("\r\n", "\n")

def run(req):
    op = req["op"]
    path = req.get("path") or "."
    cwd = req.get("cwd")
    full = path if os.path.isabs(path) else os.path.abspath(os.path.join(cwd or os.getcwd(), path))

    if op == "resolve":
        canonical = os.path.realpath(full)
        return {"ok": True, "path": canonical}

    if op == "stat" or op == "lstat":
        follow = op == "stat"
        try:
            st = os.stat(full, follow_symlinks=follow)
        except FileNotFoundError:
            return {"ok": True, "exists": False}
        return {"ok": True, "exists": True, "version": version(full, follow),
                "type": kind(full, follow), "size": st.st_size}

    if op == "read":
        regular(full)
        with open(full, "rb") as f:
            raw = f.read()
        if b"\x00" in raw[:8192]:
            fail("FS_NOT_TEXT", "binary file: " + full)
        try:
            return {"ok": True, "text": raw.decode("utf-8-sig")}
        except UnicodeDecodeError:
            fail("FS_NOT_TEXT", "not UTF-8 text: " + full)

    if op == "bytes":
        regular(full)
        limit = req.get("maxBytes")
        if type(limit) is not int or limit < 0:
            fail("FS_IO_ERROR", "maxBytes must be a non-negative integer")
        with open(full, "rb") as f:
            if os.fstat(f.fileno()).st_size > limit:
                fail("FS_TOO_LARGE", "file exceeds maxBytes: " + full)
            raw = f.read(limit + 1)
        if len(raw) > limit:
            fail("FS_TOO_LARGE", "file exceeds maxBytes: " + full)
        return {"ok": True, "base64": base64.b64encode(raw).decode("ascii")}

    if op == "range":
        regular(full)
        offset = req.get("offset")
        length = req.get("length")
        if type(offset) is not int or type(length) is not int or offset < 0 or length < 0:
            fail("FS_IO_ERROR", "offset and length must be non-negative integers")
        with open(full, "rb") as f:
            st = os.fstat(f.fileno())
            opened_version = "%d:%d:%d:%d" % (st.st_dev, st.st_ino, st.st_mtime_ns, st.st_size)
            if req.get("expectedVersion") is not None and opened_version != req["expectedVersion"]:
                fail("FS_STALE_VERSION", "file changed during streaming read")
            f.seek(offset)
            raw = f.read(length)
        return {"ok": True, "base64": base64.b64encode(raw).decode("ascii")}

    if op == "list":
        need(full)
        if not os.path.isdir(full):
            fail("FS_NOT_DIRECTORY", "not a directory: " + full)
        out = []
        with os.scandir(full) as it:
            for entry in sorted(it, key=lambda e: e.name):
                child = os.path.join(full, entry.name)
                try:
                    out.append({"name": entry.name, "path": os.path.realpath(child), "type": kind(child),
                                "version": version(child), "size": entry.stat().st_size})
                except FileNotFoundError:
                    out.append({"name": entry.name, "path": os.path.realpath(child), "type": "other", "version": ""})
        return {"ok": True, "entries": out}

    if op == "write" or op == "edit":
        policy = req.get("policy")
        full = checked_mutation_path(full, policy)
        if (op == "edit" or req.get("expectedVersion") is not None) and not os.path.exists(os.path.dirname(full)):
            fail("FS_STALE_VERSION", "file no longer exists: " + full)
        with mutation_lock(full), mutation_directory(full) as directory_fd:
            full = checked_mutation_path(full, policy)
            name = os.path.basename(full)
            try:
                existing = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
            except FileNotFoundError:
                existing = None
            if existing is not None and not stat.S_ISREG(existing.st_mode):
                fail("FS_NOT_REGULAR_FILE", "not a regular file: " + full)
            expected = req.get("expectedVersion")
            if expected is not None and (existing is None or version_of(existing) != expected):
                fail("FS_STALE_VERSION", "the file changed since it was read: " + full)
            if req.get("createOnly") and existing is not None:
                fail("FS_NOT_OBSERVED", "file already exists: " + full)
            if op == "edit" and existing is None:
                fail("FS_STALE_VERSION", "file no longer exists: " + full)
            before = None
            raw_text = None
            mode = stat.S_IMODE(existing.st_mode) if existing is not None else None
            if existing is not None:
                fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directory_fd)
                with os.fdopen(fd, "rb") as f:
                    if not stat.S_ISREG(os.fstat(f.fileno()).st_mode):
                        fail("FS_NOT_REGULAR_FILE", "not a regular file: " + full)
                    raw = f.read()
                try:
                    if b"\x00" in raw:
                        raise UnicodeDecodeError("utf-8", raw, 0, 1, "binary file")
                    raw_text = raw.decode("utf-8-sig")
                    before = normalized(raw_text)
                except UnicodeDecodeError:
                    if op == "edit":
                        fail("FS_NOT_TEXT", "not UTF-8 text: " + full)
            if op == "write":
                content = req["content"]
                after = normalized(content)
            else:
                old = normalized(req["old"])
                replacement = normalized(req["new"])
                if not old:
                    fail("FS_EDIT_NOT_FOUND", "oldString must not be empty")
                count = before.count(old)
                if count == 0:
                    fail("FS_EDIT_NOT_FOUND", "text not found in " + full)
                if count > 1 and not req.get("replaceAll"):
                    fail("FS_AMBIGUOUS_EDIT", "text matched more than once in " + full)
                after = before.replace(old, replacement)
                sample = raw_text[:4096]
                use_crlf = sample.count("\r\n") > sample.count("\n") - sample.count("\r\n")
                content = after.replace("\n", "\r\n") if use_crlf else after
            checked_mutation_path(os.path.join(os.path.realpath("/proc/self/fd/" + str(directory_fd)), name), policy)
            atomic_publish(directory_fd, name, content, bool(req.get("createOnly")), mode)
            return {"ok": True, "operation": "update" if existing is not None else "create",
                    "before": before, "after": after,
                    "version": version_of(os.stat(name, dir_fd=directory_fd, follow_symlinks=False))}

    fail("FS_IO_ERROR", "unknown operation: " + op)

try:
    result = run(json.loads(base64.b64decode(sys.argv[2]).decode("utf-8")))
    print(json.dumps(result))
except SystemExit:
    raise
except PermissionError as error:
    print(json.dumps({"ok": False, "code": "FS_PERMISSION_DENIED", "message": str(error)}))
except FileNotFoundError as error:
    print(json.dumps({"ok": False, "code": "FS_NOT_FOUND", "message": str(error)}))
except NotADirectoryError as error:
    print(json.dumps({"ok": False, "code": "FS_NOT_DIRECTORY", "message": str(error)}))
except Exception as error:
    print(json.dumps({"ok": False, "code": "FS_IO_ERROR",
                      "message": type(error).__name__ + ": " + str(error)}))
`

/**
 * Wrap one request as a shell command that runs the probe.
 * @param request - the validated probe request.
 * @returns the shell command the task environment executes.
 */
export function probeCommand(request: ProbeRequest): string {
  const payload = JSON.stringify(request)
  // Both the program and the request travel base64-encoded, so no shell
  // metacharacter in a path or a file body can change what the container
  // runs. Decoding happens inside python, not in the shell.
  const requestB64 = Buffer.from(payload, 'utf8').toString('base64')
  const scriptB64 = Buffer.from(PROBE_SOURCE, 'utf8').toString('base64')
  return `python3 -c 'import base64,sys;exec(base64.b64decode(sys.argv[1]))' '${scriptB64}' '${requestB64}'`
}
