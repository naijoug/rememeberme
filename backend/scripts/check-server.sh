#!/bin/sh
# Read-only inventory; deliberately excludes environment files and credentials.
set -eu
uname -m
if command -v node >/dev/null 2>&1; then node --version; else printf '%s\n' 'Node is not installed'; fi
free -m
df -h /
ss -ltn
systemctl list-units --type=service --state=running --no-pager
if command -v nginx >/dev/null 2>&1; then nginx -v; fi
if command -v caddy >/dev/null 2>&1; then caddy version; fi
