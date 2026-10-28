#!/bin/sh
set -eu
# The quote terminal stays up on its own. A live process is left alone.
sh /workspace/slayer/theta/keep-up.sh >>/tmp/theta-keep.log 2>&1 &
cd /workspace/slayer
if curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8080/; then
  exit 0
fi
npm run dev >>/tmp/app-startup.log 2>&1 &
