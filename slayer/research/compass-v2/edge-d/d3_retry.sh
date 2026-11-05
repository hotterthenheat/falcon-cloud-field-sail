#!/bin/sh
# After the main D3 fetch: drop errored event files (holiday / no-quote 472s) and re-fetch them with the patched code.
D=/home/user/falcon-cloud-field-sail/v2data/edge-d/d3
for f in $(grep -l '"status": "err' $D/*.json); do rm -f "$f"; done
cd /home/user/falcon-cloud-field-sail/.claude/worktrees/agent-a0c64927708e36400/slayer/research/compass-v2/edge-d
python3 d3.py fetch
grep -h -o '"status": "[a-z_]*' $D/*.json | sort | uniq -c
