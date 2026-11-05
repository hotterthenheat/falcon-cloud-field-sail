"""Blind scorer for a frozen candidate (V2_PROTOCOL rule 12).

    python3 -m eval.score_frozen --spec frozen/H007.py --commit <hash> [--split LOCKED] [--allow-relook]

The scorer needs only the spec file and the commit that froze it — no research notes. It
  1. reads the spec FROM THE COMMIT (git show <hash>:<path>), and refuses if the working file differs from it;
  2. lints it (sim/lint.py: no store/file/network access, no private attributes);
  3. runs it on every stored session of the split (data/splits.py), with the spec's own SimConfig and feeds;
  4. prints numbers only (JSON: summary, protocol bar, with and without fees) and appends the look to the look log
     (V2DATA/locked_looks.jsonl). A second LOCKED look at the same spec id is refused unless --allow-relook
     (and is logged as a re-look either way).

Frozen spec format (one .py file; template: frozen/TEMPLATE.py):
    SPEC = {'id': ..., 'registered_commit': <hash of the ledger pre-registration>, 'roots': [...],
            'sim': {SimConfig fields}, 'feeds': ['uw_alerts:SPY', ...], 'ret': 'ret_net',
            'trials_at_freeze': N, 'sr_var_trials': v or None}
    def make_strategy(day: str) -> sim.engine.Strategy      # a fresh instance per session
    def exit_policy() -> exit object                         # optional, for the null runs
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import time

import pandas as pd

from data.splits import split_of
from data.store import V2DATA, Session, list_sessions
from eval.metrics import passes_bar, summarize
from sim import feeds
from sim.engine import Engine, SimConfig
from sim.lint import check_source

LOOKS = os.path.join(V2DATA, 'locked_looks.jsonl')


def load_committed(spec_path: str, commit: str):
    top = subprocess.run(['git', 'rev-parse', '--show-toplevel'], capture_output=True, text=True,
                         cwd=os.path.dirname(os.path.abspath(spec_path))).stdout.strip()
    rel = os.path.relpath(os.path.abspath(spec_path), top)
    blob = subprocess.run(['git', 'show', f'{commit}:{rel}'], capture_output=True, cwd=top)
    if blob.returncode != 0:
        raise SystemExit(f'spec {rel} is not in commit {commit}: {blob.stderr.decode()[:200]}')
    src = blob.stdout
    if os.path.exists(spec_path) and open(spec_path, 'rb').read() != src:
        raise SystemExit('the working spec differs from the committed one: score the commit, not the edit')
    problems = check_source(src.decode(), rel)
    if problems:
        raise SystemExit('spec fails lint:\n' + '\n'.join(problems))
    with tempfile.NamedTemporaryFile('wb', suffix='.py', delete=False) as f:
        f.write(src)
    spec = importlib.util.spec_from_file_location('frozen_spec', f.name)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    os.unlink(f.name)
    return mod, hashlib.sha256(src).hexdigest(), rel


def score(mod, split: str, days=None):
    S = mod.SPEC
    days = days or [d for d in list_sessions() if split_of(d) == split]
    cfg = SimConfig(**S.get('sim', {}))
    rows = []
    for d in days:
        s = Session(d)
        ext = feeds.build(s, S.get('feeds'))
        rows += Engine(s, mod.make_strategy(d), cfg, ext).run()
    tr = pd.DataFrame(rows)
    N = int(S.get('trials_at_freeze') or 1)
    out = {'sessions': len(days)}
    for ret in ('ret_net', 'ret_gross'):
        rep = summarize(tr, days, ret=ret, n_trials=N, sr_var_trials=S.get('sr_var_trials')) if len(tr) else {'n': 0}
        out[ret] = {k: v for k, v in rep.items() if not isinstance(v, dict)}
        out[ret + '_bar'] = passes_bar(rep) if rep.get('n') else {'pass': False}
    return out, tr


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--spec', required=True)
    ap.add_argument('--commit', required=True)
    ap.add_argument('--split', default='LOCKED', choices=['DEV', 'VALIDATION', 'LOCKED'])
    ap.add_argument('--allow-relook', action='store_true')
    a = ap.parse_args()
    mod, sha, rel = load_committed(a.spec, a.commit)
    sid = mod.SPEC['id']
    prior = []
    if os.path.exists(LOOKS):
        prior = [json.loads(x) for x in open(LOOKS) if x.strip()]
    seen = [p for p in prior if p['id'] == sid and p['split'] == 'LOCKED']
    if a.split == 'LOCKED' and seen and not a.allow_relook:
        raise SystemExit(f'{sid} was already scored on LOCKED ({len(seen)} look(s)); refusing (see {LOOKS})')
    out, _ = score(mod, a.split)
    look = {'id': sid, 'commit': a.commit, 'sha256': sha, 'spec': rel, 'split': a.split, 'at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
            'relook': bool(seen), 'n': out['ret_net'].get('n', 0), 'expectancy_net': out['ret_net'].get('expectancy'),
            'pass': out['ret_net_bar'].get('pass')}
    with open(LOOKS, 'a') as f:
        f.write(json.dumps(look) + '\n')
    print(json.dumps(out, indent=1, default=str))


if __name__ == '__main__':
    sys.exit(main())
