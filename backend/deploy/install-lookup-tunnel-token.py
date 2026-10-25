#!/usr/bin/env python3
"""Receive the dedicated tunnel token with echo disabled; never put it in shell history."""
import getpass
import os
import pathlib
import re

destination = pathlib.Path('/etc/rememberme/lookup-tunnel.token')
if os.geteuid() != 0 or destination.exists():
    raise SystemExit('Requires root and a new dedicated token path')
token = getpass.getpass('Dedicated lookup tunnel token (input hidden): ').strip()
if not re.fullmatch(r'[A-Za-z0-9+/=_-]{80,4096}', token):
    raise SystemExit('Invalid dedicated tunnel token')
fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
os.fchmod(fd, 0o600)
os.fchown(fd, 0, 0)
with os.fdopen(fd, 'w') as stream:
    stream.write(token + '\n')
print('Dedicated tunnel token saved root:root mode 0600; systemd LoadCredential provides isolated access.')
