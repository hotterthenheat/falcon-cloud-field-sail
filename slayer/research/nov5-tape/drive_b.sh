#!/bin/sh
# NOV5 fetch driver B (sequential after drive_a; one terminal request in flight).
# Nov 4 (first out-of-sample day): 1-second NBBO for strikes within the day's range +-2%, every print within +-4%.
# Nov 5: the 1-second / tick stores were not built when this study started (every 1s/tick read answered 'No data',
# while 1-minute aggregates answered); probe every 30 min and fetch as soon as they are.
cd "$(dirname "$0")"
while pgrep -f "drive_a.sh" > /dev/null; do sleep 30; done
python3 fetch_tape.py q1s 20261104 7520 7860
python3 fetch_tape.py trades 20261104 7380 7990
for i in $(seq 1 24); do
  if python3 fetch_tape.py probe 20261105; then
    echo "$(date -u +%T) Nov 5 1-second store is up"
    python3 fetch_tape.py q1s 20261105 7100 7750
    python3 fetch_tape.py trades 20261105 6900 7900
    break
  fi
  echo "$(date -u +%T) Nov 5 1-second store not built yet (probe $i)"
  sleep 1800
done
echo DONE_B
