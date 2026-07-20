#!/bin/sh
set -eu

config_dir="${CONFIG_DIR:-/config}"
run_uid="${PUID:-99}"
run_gid="${PGID:-100}"

case "$run_uid:$run_gid" in
  *[!0-9:]*|:*|*:) echo "PUID und PGID müssen numerisch sein." >&2; exit 1 ;;
esac

mkdir -p "$config_dir"

if [ "$(id -u)" = "0" ]; then
  if chown -R "$run_uid:$run_gid" "$config_dir"; then
    echo "Subtrack startet mit UID $run_uid und GID $run_gid; Config: $config_dir/config.json"
    exec su-exec "$run_uid:$run_gid" node /app/index.js
  fi

  echo "Warnung: Besitzer von $config_dir konnte nicht geändert werden; Start als root." >&2
fi

exec node /app/index.js
