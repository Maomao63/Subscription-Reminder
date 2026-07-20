#!/bin/sh
set -eu

config_dir="${CONFIG_DIR:-/config}"
run_uid="${PUID:-99}"
run_gid="${PGID:-100}"

case "$run_uid:$run_gid" in
  *[!0-9:]*|:*|*:) echo "PUID and PGID must be numeric." >&2; exit 1 ;;
esac

mkdir -p "$config_dir"

if [ "$(id -u)" = "0" ]; then
  if chown -R "$run_uid:$run_gid" "$config_dir"; then
    echo "Starting Subtrack with UID $run_uid and GID $run_gid; config: $config_dir/config.json"
    exec su-exec "$run_uid:$run_gid" node /app/index.js
  fi

  echo "Warning: unable to change ownership of $config_dir; starting as root." >&2
fi

exec node /app/index.js
