#!/bin/sh
# NOV5 driver C (after the pre-registration commit; sequential, one terminal request in flight; resumable).
cd "$(dirname "$0")"
L=/home/user/falcon-cloud-field-sail/v2data/nov5-tape
while pgrep -f "drive_a.sh" > /dev/null; do sleep 30; done
echo "$(date -u +%T) Nov 4 book + first out-of-sample test"
python3 book_nov.py 20261104 > $L/book_20261104.log 2>&1
python3 runner.py study 20261104 --fetch > $L/study_20261104.txt 2>&1
echo "$(date -u +%T) DEV real side"
while pgrep -f "runner.py devbook" > /dev/null; do sleep 30; done
python3 runner.py devbook > $L/devbook2.log 2>&1
python3 runner.py dev > $L/dev.log 2>&1
echo "$(date -u +%T) DEV opposite side (side-shuffle null)"
python3 runner.py dev --flip > $L/dev_flip.log 2>&1
echo "$(date -u +%T) Nov 5 1-second store probe"
for i in $(seq 1 12); do
  if python3 fetch_tape.py probe 20261105; then
    python3 fetch_tape.py q1s 20261105 7100 7750 > $L/q1s_20261105.log 2>&1
    break
  fi
  sleep 1200
done
echo DONE_C
