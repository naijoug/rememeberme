#!/bin/sh
set -eu

# Install a reviewed release without publishing it or replacing existing data.
archive=${1:?Usage: install-private.sh ARCHIVE SHA256 PUBLIC_ORIGIN}
expected=${2:?Missing archive SHA256}
origin=${3:?Missing planned HTTPS origin}
case "$origin" in
  https://*) ;;
  *) echo "An HTTPS origin is required" >&2; exit 1 ;;
esac
actual=$(sha256sum "$archive" | cut -d ' ' -f 1)
[ "$actual" = "$expected" ] || { echo "Archive digest mismatch" >&2; exit 1; }
node --input-type=module -e "import { DatabaseSync } from 'node:sqlite'; const db = new DatabaseSync(':memory:'); db.close()"

for path in /opt/rememberme/current /etc/rememberme /var/lib/rememberme /etc/systemd/system/rememberme-api.service; do
  if [ -e "$path" ] || [ -L "$path" ]; then
    echo "Existing deployment found at $path; inspect and back up before migration" >&2
    exit 1
  fi
done
if ss -lnt | awk '{print $4}' | grep -q ':8787$'; then
  echo "Port 8787 is already in use" >&2
  exit 1
fi

release_id=$(printf '%.12s' "$expected")
release_date=$(date -u +%Y%m%d)
release="/opt/rememberme/releases/$release_date-$release_id"
[ ! -e "$release" ] || { echo "Release already exists" >&2; exit 1; }
getent passwd rememberme >/dev/null || useradd --system --home-dir /var/lib/rememberme --shell /usr/sbin/nologin rememberme
install -d -m 0755 /opt/rememberme /opt/rememberme/releases "$release"
tar -xzf "$archive" -C "$release"
chown -R root:root "$release"
chmod -R go-w "$release"
install -d -m 0700 /etc/rememberme
install -d -o rememberme -g rememberme -m 0700 /var/lib/rememberme
umask 077
cat > /etc/rememberme/api.env <<EOF
ENVIRONMENT=production
PUBLIC_ORIGIN=$origin
PORT=8787
DATABASE_PATH=/var/lib/rememberme/rememberme.sqlite
TRUST_LOOPBACK_PROXY=true
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
NATIVE_CALLBACKS=rememberme://auth/callback
CLIENT_ORIGINS=
EOF
ln -s "$release/runtime" /opt/rememberme/current
install -m 0644 "$release/deploy/rememberme-api.service" /etc/systemd/system/rememberme-api.service
systemctl daemon-reload
systemctl enable --now rememberme-api.service
systemctl is-active rememberme-api.service
printf 'Installed private release: %s\n' "$release"
printf 'No public proxy or OAuth credentials have been configured.\n'
