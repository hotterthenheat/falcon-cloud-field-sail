#!/bin/bash
# Housekeeping loop (every 10 min): rows csv.gz -> parquet, built days' raw cache -> tar.xz, 1.4 GB budget.
#   setsid nohup bash slayer/research/compass-v2/oos2/housekeep.sh > /dev/null 2>&1 &
HERE="$(cd "$(dirname "$0")" && pwd)"
export CHAL_DATA=/home/user/falcon-cloud-field-sail/v2data/oos2
OOS2_LOOP=1 exec python3 "$HERE/pack_raw.py" >> "$CHAL_DATA/logs/housekeep.log" 2>&1
