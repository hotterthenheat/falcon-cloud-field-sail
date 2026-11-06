#!/bin/sh
# NOV5 driver D (after C; one terminal request in flight): Nov 5 tick prints with the NBBO in force, liquid band.
cd "$(dirname "$0")"
L=/home/user/falcon-cloud-field-sail/v2data/nov5-tape
while pgrep -f "drive_c.sh" > /dev/null; do sleep 30; done
python3 fetch_tape.py trades 20261105 7100 7750 > $L/trades_20261105.log 2>&1
echo DONE_D
