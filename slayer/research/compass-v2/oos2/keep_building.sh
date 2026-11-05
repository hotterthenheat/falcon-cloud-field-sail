#!/bin/bash
# Keeps one row builder alive while run_pipeline.sh fetches (its builder has a 16-h time box): whenever no
# pipeline/build.ts is running, start one (oldest first, 10-h box). Stop: touch $CHAL_DATA/STOP.
#   setsid nohup bash slayer/research/compass-v2/oos2/keep_building.sh > /dev/null 2>&1 &
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE/../../.." || exit 1
export CHAL_DATA=/home/user/falcon-cloud-field-sail/v2data/oos2
export CHAL_DAYS="$HERE/LOCKED2.json" OMP_WAIT_POLICY=PASSIVE
unset CHAL_NET
TSX=/home/user/falcon-cloud-field-sail/.claude/worktrees/agent-a3673bb87994bc8be/slayer/node_modules/.bin/tsx
LOG=$CHAL_DATA/logs
while [ ! -f "$CHAL_DATA/STOP" ]; do
  if ! pgrep -f 'pipeline/build.ts' > /dev/null; then
    echo "builder (re)started $(date -u +%FT%TZ)" >> "$LOG/driver.log"
    CHAL_BUILD_CONC=1 $TSX research/compass-v2/oos2/pipeline/build.ts --oldest --minutes 600 >> "$LOG/build.log" 2>&1
    python3 "$HERE/convert_rows.py" >> "$LOG/convert.log" 2>&1
  fi
  sleep 300
done
