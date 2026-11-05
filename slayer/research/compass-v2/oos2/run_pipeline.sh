#!/bin/bash
# OOS2: build the pre-registered LOCKED-2 block (PREREG.md / LOCKED2.json) with the challenger's own pipeline
# (pipeline/fetch.ts, build.ts, localHost.ts: verbatim copies, imports pointed at the challenger engine tree), SPXW
# only, one terminal request in flight, one row builder, cache under v2data/oos2. Resumable: re-run to continue.
#   setsid nohup bash slayer/research/compass-v2/oos2/run_pipeline.sh > /dev/null 2>&1 &
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE/../../.." || exit 1            # slayer/ (tsconfig)
export CHAL_DATA=/home/user/falcon-cloud-field-sail/v2data/oos2
export CHAL_DAYS="$HERE/LOCKED2.json"   # never a session outside the registered block
export CHAL_CONC=1 OMP_WAIT_POLICY=PASSIVE
unset CHAL_NET                           # no 1-second reads: the scorer fetches its own 1-s NBBO per call
TSX=/home/user/falcon-cloud-field-sail/.claude/worktrees/agent-a3673bb87994bc8be/slayer/node_modules/.bin/tsx
LOG=$CHAL_DATA/logs
mkdir -p "$LOG"
echo "start $(date -u +%FT%TZ) pid $$" >> "$LOG/driver.log"

# one row builder, picks up fetched days as they land (newest first inside a block), ~16 h time box
CHAL_BUILD_CONC=1 $TSX research/compass-v2/oos2/pipeline/build.ts --oldest --minutes 960 >> "$LOG/build.log" 2>&1 &
B=$!
# csv.gz -> parquet as days are built (disk)
OOS2_LOOP=1 python3 "$HERE/convert_rows.py" >> "$LOG/convert.log" 2>&1 &
CV=$!

# fetch, by priority: 2025 Q2-Q4 (tariff shock + after), 2023, late 2022 + early 2022, 2026 H1, 2024, Nov 2026
for range in "2025-11-12 2025-04-01" "2023-12-29 2023-01-03" "2022-12-30 2022-11-01" "2022-02-15 2022-01-26" \
             "2026-06-29 2026-01-02" "2024-07-12 2024-01-02" "2024-12-31 2024-09-03" "2026-11-04 2026-11-02"; do
  set -- $range
  for pass in 1 2; do
    echo "fetch $1..$2 pass $pass $(date -u +%FT%TZ)" >> "$LOG/driver.log"
    $TSX research/compass-v2/oos2/pipeline/fetch.ts --roots SPXW --from "$1" --to "$2" --minutes 900 >> "$LOG/fetch.log" 2>&1
  done
done
echo "fetch done $(date -u +%FT%TZ)" >> "$LOG/driver.log"
wait $B
kill $CV 2>/dev/null
python3 "$HERE/convert_rows.py" >> "$LOG/convert.log" 2>&1
echo "end $(date -u +%FT%TZ)" >> "$LOG/driver.log"
