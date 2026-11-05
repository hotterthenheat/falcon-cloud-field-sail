"""Validate the simulator against real recorded Compass calls.

    python3 -m validation.compass_replay [--fetch]

Sources (read-only): the live record of 2026-10-29 (slayer/.cache/compass/2026-10-29.json: 5 calls + 5 would-calls)
and the Nov 4 replay (nov4/replay/2026-11-04.json: 32 calls, 29 with an outcome). For every call with a fill:
  1. QUOTE CHECK  the recorded fill bid/ask (Compass fills at the ask of the NBBO a full minute after the mark) and the
                  recorded exit price (a bid) against the terminal's 100 ms NBBO in force at the same instant;
                  plus, where the minute cache exists (nov4data npz), the minute board against the same quotes.
  2. ENGINE CHECK the call replayed through sim.engine (decision at the mark, latency = the recorded fill delay, exit
                  order arriving at the recorded exit time): the engine's fill and exit must equal the recorded ones.
  3. REALISM      the same entries with the protocol's execution (2 s latency from the mark, ask/bid, displayed size)
                  and the Compass exit time: how much the paper fill differs from what a 2-second order gets.
Quotes are cached under V2DATA/validation/<day>/<root>_quotes.parquet (small: one file per day, the calls' contracts).
"""
from __future__ import annotations

import argparse
import json
import os
import sys

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from data.store import V2DATA, Contract
from eval.report import md_table
from sim.engine import Engine, SimConfig, Strategy, clock, fmt_ms
from sim.exits import FnExit
from sim.memsession import MemSession

RECORDS = ['/home/user/falcon-cloud-field-sail/slayer/.cache/compass/2026-10-29.json',
           '/home/user/falcon-cloud-field-sail/.claude/worktrees/agent-aae4d8e1c86033fac/slayer/research/nov4/replay/2026-11-04.json']
NOV4DATA = '/tmp/claude-0/-home-user/f71fb141-33a0-5344-9573-1a2ad4706812/scratchpad/nov4data'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)))


def et_ms(epoch_ms: int, day: str) -> int:
    t = pd.Timestamp(int(epoch_ms), unit='ms', tz='UTC').tz_convert('America/New_York')
    return int((t - t.normalize()).total_seconds() * 1000)


def load_calls() -> pd.DataFrame:
    rows = []
    for f in RECORDS:
        d = json.load(open(f))
        for kind in ('calls', 'would'):
            for c in d.get(kind) or []:
                o = c.get('outcome') or {}
                if not o.get('fill') or not o.get('exit'):
                    continue
                day = c['day'].replace('-', '')
                rows.append({
                    'day': day, 'kind': kind, 'book': c['book'], 'root': c['ticker'], 'contract_str': c['contract'],
                    'exp': c['expiry'].replace('-', ''), 'strike': float(c['strike']), 'right': 1 if c['right'] == 'C' else -1,
                    'mark_ms': et_ms(c['firedAt'], day), 'fill_ms': et_ms(o['fill']['at'], day),
                    'rec_fill_bid': o['fill']['bid'], 'rec_fill_ask': o['fill']['ask'],
                    'exit_ms': et_ms(o['exit']['at'], day), 'rec_exit_px': float(o['exit']['px']), 'why': o['exit'].get('why', '')[:40],
                    'rec_ret': o.get('ret')})
    return pd.DataFrame(rows)


def qpath(day, root):
    return os.path.join(V2DATA, 'validation', day, f'{root}_quotes.parquet')


def fetch(calls: pd.DataFrame):
    from data.fetch import NoData, contract_quotes, write
    for (day, root), g in calls.groupby(['day', 'root']):
        p = qpath(day, root)
        if os.path.exists(p):
            continue
        os.makedirs(os.path.dirname(p), exist_ok=True)
        parts = []
        for r in g.drop_duplicates(['exp', 'strike', 'right']).itertuples():
            try:
                parts.append(contract_quotes(root, r.exp, r.strike, r.right, day))
            except NoData:
                print('no data', day, root, r.exp, r.strike, r.right)
        if parts:
            df = pd.concat(parts).sort_values(['exp', 'strike', 'right', 'ms'], kind='stable')
            write(pa.Table.from_pandas(df, preserve_index=False), p)
            print('fetched', day, root, len(parts), 'contracts', len(df), 'rows')


def quotes_for(day, root) -> dict:
    from data.store import _split_by_contract
    p = qpath(day, root)
    if not os.path.exists(p):
        return {}
    return _split_by_contract(pq.read_table(p).to_pandas(), root)


def asof(q, t):
    i = int(np.searchsorted(q['ms'], t, side='right')) - 1
    return (q['bid'][i] / 100, q['ask'][i] / 100, int(q['bs'][i]), int(q['as'][i]), int(q['ms'][i])) if i >= 0 else None


class Replay(Strategy):
    timer_ms = 1000

    def __init__(self, c, mark_ms, exit_decision_ms):
        self.c, self.mark, self.exit_at, self.done = c, mark_ms, exit_decision_ms, False

    def on_event(self, ctx, ev):
        if not self.done and ctx.now >= self.mark:
            self.done = True
            at = self.exit_at
            ctx.buy(self.c, 1, exit=FnExit(lambda cx, pos: 'recorded exit' if cx.now >= at else None))


def engine_run(q, c, day, mark, latency, exit_decision):
    s = MemSession(day, {c: q})
    st = Replay(c, mark, exit_decision)
    st.start_at = fmt_ms(mark)          # the first timer event is the mark itself (ms precision)
    cfg = SimConfig(latency_ms=latency, flat_ms=clock('15:59:59'), end_ms=clock('16:15'))
    log = Engine(s, st, cfg).run()
    return log[0] if log else None


def npz_check(day, root, exp, strike, right, q, t_ms):
    """The minute cache's board at the minute of t_ms against our quote in force at that minute's start and end."""
    f = os.path.join(NOV4DATA, f'{day[:4]}-{day[4:6]}-{day[6:]}_{root}_{exp[:4]}-{exp[4:6]}-{exp[6:]}.npz')
    if not os.path.exists(f):
        return None
    z = np.load(f)
    rr = 'C' if right == 1 else 'P'
    idx = [i for i, (k, r) in enumerate(zip(z['strike'], z['right'])) if abs(k - strike) < 1e-6 and r == rr]
    if not idx:
        return None
    m = (t_ms - clock('09:30')) // 60_000
    if not 0 <= m < z['bid'].shape[1]:
        return None
    nb, na = float(z['bid'][idx[0], m]), float(z['ask'][idx[0], m])
    s0 = asof(q, clock('09:30') + m * 60_000)
    s1 = asof(q, clock('09:30') + m * 60_000 + 59_999)
    return {'npz_bid': nb, 'npz_ask': na, 'match_min_start': bool(s0 and abs(s0[0] - nb) < 0.005 and abs(s0[1] - na) < 0.005),
            'match_min_end': bool(s1 and abs(s1[0] - nb) < 0.005 and abs(s1[1] - na) < 0.005)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--fetch', action='store_true')
    a = ap.parse_args()
    calls = load_calls()
    if a.fetch:
        fetch(calls)
    rows = []
    for r in calls.itertuples():
        qs = quotes_for(r.day, r.root)
        c = Contract(r.root, int(r.exp), int(round(r.strike * 1000)), r.right)
        if c not in qs:
            rows.append({'call': f'{r.day} {r.contract_str} {r.exp}', 'status': 'no quotes'})
            continue
        q = qs[c]
        f = asof(q, r.fill_ms)
        x = asof(q, r.exit_ms)
        row = {'call': f'{r.day} {r.book} {r.contract_str} exp {r.exp}', 'fill_at': fmt_ms(r.fill_ms)[:8],
               'rec_bid_ask': f'{r.rec_fill_bid:.2f}/{r.rec_fill_ask:.2f}', 'tape_bid_ask': f'{f[0]:.2f}/{f[1]:.2f}',
               'fill_match': abs(f[0] - r.rec_fill_bid) < 0.005 and abs(f[1] - r.rec_fill_ask) < 0.005,
               'exit_at': fmt_ms(r.exit_ms)[:8], 'rec_exit': r.rec_exit_px, 'tape_exit_bid': x[0],
               'exit_match': abs(x[0] - r.rec_exit_px) < 0.005, 'why': r.why}
        # engine with Compass's own timing: decision at the mark, fill latency as recorded, exit arriving at exit_ms
        lat = r.fill_ms - r.mark_ms
        e = engine_run(q, c, r.day, r.mark_ms, lat, r.exit_ms - lat)
        row['eng_entry'] = e['entry_px'] if e else None
        row['eng_exit'] = e['exit_px'] if e else None
        row['eng_match'] = bool(e and abs(e['entry_px'] - r.rec_fill_ask) < 0.005 and abs(e['exit_px'] - r.rec_exit_px) < 0.005)
        # protocol execution: 2 s after the mark; the same exit time (decided 2 s before it arrives)
        e2 = engine_run(q, c, r.day, r.mark_ms, 2000, r.exit_ms - 2000)
        if e2:
            row.update(p2_entry=e2['entry_px'], p2_ask_size=e2['entry_ask_size'], p2_exit=e2['exit_px'],
                       p2_ret_gross=e2['ret_gross'], rec_ret_gross=r.rec_exit_px / r.rec_fill_ask - 1)
        nz = npz_check(r.day, r.root, r.exp, r.strike, r.right, q, r.fill_ms)
        if nz:
            row.update(nz)
        rows.append(row)
    df = pd.DataFrame(rows)
    ok = df[df.get('fill_match').notna()] if 'fill_match' in df else df
    lines = ['# Simulator validation against recorded Compass calls', '',
             f'Calls with a recorded fill and exit: {len(calls)} (2026-10-29: {sum(calls.day == "20261029")}, '
             f'2026-11-04: {sum(calls.day == "20261104")}); quotes found for {len(ok)}.', '',
             f'- Recorded fill bid/ask == terminal 100 ms NBBO in force at the fill instant: **{int(ok.fill_match.sum())}/{len(ok)}**',
             f'- Recorded exit price == terminal bid in force at the exit instant: **{int(ok.exit_match.sum())}/{len(ok)}**',
             f'- Engine replay (Compass timing) reproduces entry ask and exit bid: **{int(ok.eng_match.sum())}/{len(ok)}**']
    if 'match_min_start' in ok:
        nz = ok[ok.match_min_start.notna()]
        lines.append(f'- Minute cache (nov4data) board at the fill minute == our quote in force at the minute START: '
                     f'{int(nz.match_min_start.sum())}/{len(nz)}; at the minute END: {int(nz.match_min_end.sum())}/{len(nz)}')
    if 'p2_entry' in ok:
        slip = ok.p2_entry.astype(float) / ok.rec_bid_ask.str.split('/').str[1].astype(float) - 1
        lines += ['', '**Protocol execution (2 s after the mark, at the ask, displayed size) vs the Compass paper fill (ask one '
                  'minute after the mark):**',
                  f'- entry price ratio 2s-fill / paper-fill: median {np.median(slip)*100:+.2f}%, '
                  f'mean {np.mean(slip)*100:+.2f}%, range [{slip.min()*100:+.1f}%, {slip.max()*100:+.1f}%]',
                  f'- mean gross return per call: paper {ok.rec_ret_gross.mean()*100:+.2f}%, 2-second execution '
                  f'{ok.p2_ret_gross.mean()*100:+.2f}%',
                  f'- displayed ask size at the 2 s fill: median {int(ok.p2_ask_size.median())}, min {int(ok.p2_ask_size.min())}']
    mism = ok[~(ok.fill_match & ok.exit_match)]
    if len(mism):
        lines += ['', '**Mismatches**', '', md_table(mism[['call', 'fill_at', 'rec_bid_ask', 'tape_bid_ask', 'exit_at', 'rec_exit',
                                                  'tape_exit_bid', 'why']])]
    lines += ['', '**Every call**', '', md_table(df.drop(columns=[c for c in ('npz_bid', 'npz_ask') if c in df]))]
    open(os.path.join(OUT, 'COMPASS_REPLAY.md'), 'w').write('\n'.join(lines) + '\n')
    print('\n'.join(lines[:14]))


if __name__ == '__main__':
    sys.exit(main())
