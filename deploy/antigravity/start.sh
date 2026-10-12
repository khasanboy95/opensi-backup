#!/bin/sh
set -eu
umask 077
mkdir -p /state/.local/share/keyrings /state/connector /run/opensi
if [ ! -f /state/keyring-passphrase ]; then
  node -e 'require("fs").writeFileSync("/state/keyring-passphrase",require("crypto").randomBytes(48).toString("hex"),{mode:0o600})'
fi
dbus-daemon --session --address="$DBUS_SESSION_BUS_ADDRESS" --fork --nopidfile
gnome-keyring-daemon --unlock --components=secrets < /state/keyring-passphrase >/dev/null
exec node /opt/connector/service.mjs
