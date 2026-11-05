#!/bin/bash
# EDGE-V DEV pipeline, one terminal request in flight throughout: SPY+SPXW 1-s trades, QQQ volume bars, QQQ 1-s trades.
cd "$(dirname "$0")"
V_ROOTS=SPY,SPXW python3 v1.py run DEV && echo STAGE1_DONE
python3 vfetch.py DEV QQQ && echo STAGE2_DONE
V_ROOTS=QQQ python3 v1.py run DEV && echo STAGE3_DONE
