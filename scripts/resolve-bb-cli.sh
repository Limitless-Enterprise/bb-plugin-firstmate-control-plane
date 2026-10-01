#!/usr/bin/env bash
# Print an absolute bb CLI path for live Fleet checks (stdout). Exit 1 if none.
set -euo pipefail

if [ -n "${BB_CLI:-}" ] && command -v "$BB_CLI" >/dev/null 2>&1; then
  resolved="$(command -v "$BB_CLI")"
  if [ -n "${DISPLAY:-}" ] || [[ "$resolved" != *.appimage ]]; then
    printf '%s\n' "$resolved"
    exit 0
  fi
fi

if command -v bb >/dev/null 2>&1; then
  command -v bb
  exit 0
fi

host_daemon_glob="/tmp/.mount_bb.app*/resources/app.asar.unpacked/node_modules/bb-app/host-daemon/dist/bb"
if [ -z "${DISPLAY:-}" ]; then
  candidates=($host_daemon_glob /home/dave4272/AppImages/bb.appimage)
else
  candidates=(/home/dave4272/AppImages/bb.appimage $host_daemon_glob)
fi
for candidate in "${candidates[@]}"; do
  for path in $candidate; do
    if [ -x "$path" ]; then
      printf '%s\n' "$path"
      exit 0
    fi
  done
done

exit 1
