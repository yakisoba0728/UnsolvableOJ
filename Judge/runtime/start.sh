#!/bin/sh
set -eu

# The host cgroup root cannot be limited; no ceiling is needed when host swap is off.
if [ "$(wc -l < /proc/swaps)" -gt 1 ]; then
  if [ -f /sys/fs/cgroup/memory.swap.max ]; then
    echo 0 > /sys/fs/cgroup/memory.swap.max
  else
    echo 'cgroup v1 requires host swap to be disabled' >&2
    exit 1
  fi
fi
exec /opt/go-judge "$@"
