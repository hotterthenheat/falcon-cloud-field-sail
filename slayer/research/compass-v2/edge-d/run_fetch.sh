#!/bin/sh
cd /home/user/falcon-cloud-field-sail/.claude/worktrees/agent-a0c64927708e36400/slayer/research/compass-v2/edge-d
python3 fetch_events.py --topup
python3 fetch_events.py --plan plan.csv
