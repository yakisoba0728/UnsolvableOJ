#!/bin/sh
set -eu

# Descendant cgroups inherit this no-swap ceiling; go-judge does not set it itself.
if [ -f /sys/fs/cgroup/memory.swap.max ]; then
  echo 0 > /sys/fs/cgroup/memory.swap.max
elif [ "$(wc -l < /proc/swaps)" -gt 1 ]; then
  echo 'cgroup v1 requires host swap to be disabled' >&2
  exit 1
fi
exec /opt/go-judge "$@"
