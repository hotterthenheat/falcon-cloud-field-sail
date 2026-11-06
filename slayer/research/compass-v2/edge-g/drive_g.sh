#!/bin/bash
# EDGE-G driver: one terminal request in flight at any time (the book fetcher first, then the phases in order).
# Resumable: every step skips what is on disk. Log: v2data/edge-g/drive.log
cd "$(dirname "$0")"
D=/home/user/falcon-cloud-field-sail/v2data/edge-g
while kill -0 "$(cat $D/fetch_book.pid)" 2>/dev/null; do sleep 30; done
echo "$(date -u +%H:%M:%S) book fetch finished" >> $D/drive.log
# P1 incrementally while the book builder finishes
while kill -0 "$(cat $D/book.pid)" 2>/dev/null; do
  python3 signals_g.py >> $D/drive.log 2>&1
  python3 sim_g.py run P1 >> $D/drive.log 2>&1
  sleep 60
done
python3 signals_g.py >> $D/drive.log 2>&1
for ph in P1 P2 P3 P4; do
  python3 sim_g.py run $ph >> $D/drive.log 2>&1
  echo "$(date -u +%H:%M:%S) phase $ph finished" >> $D/drive.log
done
echo "$(date -u +%H:%M:%S) all phases finished" >> $D/drive.log
