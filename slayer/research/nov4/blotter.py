"""
Nov 4 research: the replayed blotter (scripts/compass-replay.ts output) as a table, with why each loser lost:
how fast the stop came, what the underlying did from the fill to the exit (signed for the side), the spread paid,
and whether the entry came after the move (the underlying's and the contract's last 15 minutes before the mark).

  python3 -I research/nov4/blotter.py research/nov4/replay/2026-11-04.json
"""
import json, os, sys
from datetime import datetime, timezone, timedelta
import numpy as np

DATA = os.environ.get('NOV4_DATA', '/tmp/claude-0/-home-user/f71fb141-33a0-5344-9573-1a2ad4706812/scratchpad/nov4data')
INDEX_UNDER = {'SPXW': 'SPX', 'XSP': 'SPX', 'NDXP': 'NDX', 'RUTW': 'RUT', 'VIX': 'VIX'}
MODEL = {'A': 'Model 1 Hit', 'B': 'Model 2 Runner', 'C': 'Model 3 Late sweep'}


def et(ms):
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc) - timedelta(hours=5)  # EST (after 2026-11-01)


def mi(ms):  # minutes after 09:30 ET
    t = et(ms)
    return t.hour * 60 + t.minute - 570


def under(day, root):
    f = os.path.join(DATA, f'{day}_U_{INDEX_UNDER.get(root, root)}.npz')
    if not os.path.exists(f):
        return None
    c = np.load(f)['c'].astype(float)
    c = np.where(c > 0, c, np.nan)
    return c / 10 if root == 'XSP' else c


def at(c, m):
    """The underlying at minute m (the close of bar m-1)."""
    if c is None or m <= 0 or m > len(c):
        return np.nan
    v = c[:m]
    v = v[np.isfinite(v)]
    return v[-1] if len(v) else np.nan


doc = json.load(open(sys.argv[1]))
day = doc['day']
tot = {}
print(f'{"model":18s} {"contract":16s} {"exp":10s} {"mark":5s} {"fill":>6s} {"exit":>6s} {"exit at":8s} {"P&L $":>8s} {"ret":>6s}  result / why')
for c in sorted(doc['calls'], key=lambda s: s['firedAt']):
    o = c.get('outcome') or {}
    fill, ex = o.get('fill'), o.get('exit')
    mk = c.get('mark') or c['firedAt']
    model = MODEL.get(c['book'], c['book']) + (' (riding)' if c.get('runner') and c['book'] == 'A' else '')
    pnl, ret = o.get('pnl'), o.get('ret')
    sgn = 1 if c['contract'].endswith('C') else -1
    U = under(day, c['ticker'])
    why = []
    if fill and ex:
        m0, m1 = mi(fill['at']), mi(ex['at'])
        held = (ex['at'] - fill['at']) / 60000
        u0, u1 = at(U, m0), at(U, m1)
        upre = (at(U, mi(mk)) / at(U, mi(mk) - 15) - 1) * sgn if mi(mk) >= 15 else np.nan
        umove = (u1 / u0 - 1) * sgn
        spread = (fill['ask'] - fill['bid']) / fill['ask'] if fill['ask'] > 0 else np.nan
        why.append(f"{ex['why']} after {held:.0f} min")
        why.append(f'underlying {umove * 100:+.2f}% its way while held')
        if np.isfinite(upre):
            why.append(f'{upre * 100:+.2f}% its way in the 15 min before the mark')
        why.append(f'spread {spread * 100:.1f}% of the ask')
    result = 'WIN' if (pnl or 0) > 0 else 'LOSS' if (pnl or 0) < 0 else 'flat'
    k = MODEL.get(c['book'], c['book'])
    t = tot.setdefault(k, [0, 0, 0.0, []])
    t[0] += 1; t[1] += result == 'WIN'; t[2] += pnl or 0
    if ret is not None:
        t[3].append(ret)
    print(f'{model:18s} {c["contract"]:16s} {c["expiry"]:10s} {et(mk).strftime("%H:%M"):5s} {fill["ask"] if fill else float("nan"):6.2f} '
          f'{ex["px"] if ex else float("nan"):6.2f} {et(ex["at"]).strftime("%H:%M:%S") if ex else "-":8s} {pnl if pnl is not None else float("nan"):8.0f} '
          f'{(ret or 0):+6.1f}  {result}: ' + '; '.join(why))
print()
for k, (n, w, p, rets) in tot.items():
    print(f'{k:20s} calls {n}  won {w}  P&L ${p:,.0f}  avg ret {np.mean(rets) if rets else float("nan"):+.1f}%')
print(f'{"all":20s} calls {sum(v[0] for v in tot.values())}  won {sum(v[1] for v in tot.values())}  P&L ${sum(v[2] for v in tot.values()):,.0f}')
