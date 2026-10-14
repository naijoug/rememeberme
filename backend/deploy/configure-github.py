"""Install confirmed GitHub OAuth credentials from one private JSON stdin line.

Use a root process with terminal echo disabled. This updates the API environment
only; vocabulary, database files and callback allowlists are not modified.
"""
import datetime
import json
import os
from pathlib import Path
import re
import sys
import tempfile


def main():
    if os.geteuid() != 0:
        raise SystemExit("Run as root to configure the private API environment")
    payload = json.loads(sys.stdin.readline(1024))
    expected = {"GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"}
    if not isinstance(payload, dict) or set(payload) != expected:
        raise SystemExit("Expected only GitHub OAuth client ID and secret")
    if not isinstance(payload["GITHUB_CLIENT_ID"], str) or not re.fullmatch(r"[A-Za-z0-9_-]{16,100}", payload["GITHUB_CLIENT_ID"]):
        raise SystemExit("Invalid OAuth client ID")
    if not isinstance(payload["GITHUB_CLIENT_SECRET"], str) or not re.fullmatch(r"[A-Za-z0-9_-]{32,100}", payload["GITHUB_CLIENT_SECRET"]):
        raise SystemExit("Invalid OAuth secret")
    path = Path("/etc/rememberme/api.env")
    if path.is_symlink() or path.stat().st_uid != 0:
        raise SystemExit("Inspect environment-file ownership before configuring it")
    old = path.read_text()
    values = {}
    for line in old.splitlines():
        name, separator, value = line.partition("=")
        if separator:
            values[name] = json.loads(value) if value.startswith('"') else value
    if values.get("PUBLIC_ORIGIN") != "https://rememberme.couplelabs.cn":
        raise SystemExit("Unexpected public origin; review the deployment first")
    if any(values.get(name) and values[name] != payload[name] for name in expected):
        raise SystemExit("Different credentials are already configured; inspect before replacing them")
    if all(values.get(name) == payload[name] for name in expected):
        print("Confirmed OAuth credentials are already configured; no changes needed.")
        return
    if any(sum(line.startswith(name + "=") for line in old.splitlines()) != 1 for name in expected):
        raise SystemExit("Expected one existing configuration line per OAuth field")
    os.umask(0o077)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    backup = path.with_name("api.env.pre-github-" + stamp)
    with backup.open("x") as destination:
        destination.write(old)
        destination.flush()
        os.fsync(destination.fileno())
    os.chmod(backup, 0o600)
    lines = [line.partition("=")[0] + "=" + json.dumps(payload[line.partition("=")[0]])
             if line.partition("=")[0] in expected else line for line in old.splitlines()]
    descriptor, temporary_name = tempfile.mkstemp(prefix="api.env.github-", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w") as destination:
            destination.write("\n".join(lines) + "\n")
            destination.flush()
            os.fsync(destination.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
        directory_fd = os.open(path.parent, os.O_DIRECTORY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        if temporary.exists():
            temporary.unlink()
    print("GitHub OAuth configured; prior environment retained. No vocabulary or callback changes.")


if __name__ == "__main__":
    main()
