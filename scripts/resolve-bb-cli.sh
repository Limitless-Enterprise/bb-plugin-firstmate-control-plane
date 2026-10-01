#!/usr/bin/env bash
# Print an absolute bb CLI path for live Fleet checks (stdout). Exit 1 if none.
set -euo pipefail

if [ -n "${BB_CLI:-}" ] && command -v "$BB_CLI" >/dev/null 2>&1; then
  printf '%s\n' "$(command -v "$BB_CLI")"
  exit 0
fi

if command -v bb >/dev/null 2>&1; then
  command -v bb
  exit 0
fi

for candidate in \
  /home/dave4272/AppImages/bb.appimage \
  /tmp/.mount_bb.app*/resources/app.asar.unpacked/node_modules/bb-app/host-daemon/dist/bb; do
  for path in $candidate; do
    if [ -x "$path" ]; then
      printf '%s\n' "$path"
      exit 0
    fi
  done
done

exit 1
