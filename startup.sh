#!/bin/sh
set -eu
# Revive contract: bring the dev server back on 0.0.0.0:8080. The dev server also starts the ThetaData supervisor.
cd "$(dirname "$0")/slayer"
if curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8080/; then
  exit 0
fi
npm run dev >>/tmp/app-startup.log 2>&1 &
