"""NOV5-BROAD runner: triggers (brules.py) -> contract pick -> 1-second path -> exits (bsim.py), on the study day, the
out-of-sample days and DEV. Every registered variant (PREREG.md):

  RULE-EXIT-EXPR   EXPR L = long single option (0DTE / first expiry, delta 0.30; R3: the ATM straddle)
                        S = debit spread (long leg as L, short the further-OTM strike at ~half its delta; R3: both sides)

  python3 brunner.py day 20261105 SPXW,SPY,...   a study / out-of-sample day (whole-day 1-second files, else fetch)
  python3 brunner.py dev [minutes] [--flip]       DEV sessions (pre-2025) of SPXW/SPY/QQQ/IWM, resumable
Results: v2data/nov5-broad/res/<tag>/<root>_<day>.json (atomic, resumable).
"""
import datetime as dt, gzip, json, math, os, sys, time
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bsim as BS  # noqa: E402  (first: sets the terminal client's data dir)
import bload as B  # noqa: E402
import brules as RU  # noqa: E402
sys.path.insert(0, os.path.join(HERE, '..', 'nov5-tape', 'edgeg'))
import common as EC  # noqa: E402
import sim as esim  # noqa: E402

DS = BS.DS
RES = os.path.join(B.OUT, 'res')
VOLIX = {'SPXW': 'VIX', 'SPY': 'VIX', 'QQQ': 'VXN', 'IWM': 'RVX'}
EXITS = {'R1': ('XB', 'XR'), 'R2': ('XB', 'XR'), 'R3': ('XP',), 'R4': ('XB',), 'R5': ('XB',)}
EXPRS = ('L', 'S')
TARGET = 0.30
WIN = 92 * 60
PRE = 30 * 60
DEV_ROOTS = ('SPXW', 'SPY', 'QQQ', 'IWM')


def variants():
    return [f'{r}-{x}-{e}' for r in EXITS for x in EXITS[r] for e in EXPRS]


def iso(day):
    return day if '-' in day else f'{day[:4]}-{day[4:6]}-{day[6:]}'


# ---------------------------------------------------------------- day builders


def chase_flag(fl, D):
    if not len(fl):
        return fl
    exp_d = pd.to_datetime(fl.expiry)
    dte = (exp_d - pd.Timestamp(iso(D))).dt.days
    otm = np.where(fl.type == 'call', fl.strike > fl.und, fl.strike < fl.und)
    return fl.assign(chase=(fl.prem >= 1e5) & otm & (dte <= 7) & (fl.ask_prem >= 0.5 * fl.prem))


def volix_study(D, root):
    sym = VOLIX.get(root)
    if not sym:
        return {}
    v = B.vix(D, sym)
    if v is None:
        return {}
    s, p = v
    out = {}
    for m in range(570, 960):
        j = np.searchsorted(s, m * 60, side='right') - 1
        if j >= 0:
            out[m] = float(p[j])
    return out


def study_day(D, root):
    e0 = B.expiries(D, root)[0]
    x = B.sessions_to_expiry(D, e0)
    bars = B.bars(D, root)
    ch = B.chain(D, root, e0)
    fzf = os.path.join(B.rdir(D, root), 'frozen_1m.parquet')
    if os.path.exists(fzf):
        fz = pd.read_parquet(fzf)
        if len(fz):
            key = set(zip(fz.k.astype(float), fz.r.astype(int), fz.m.astype(int)))
            ch = ch[[(float(k), int(r), int(m)) not in key for k, r, m in zip(ch.k, ch.r, ch.m)]]
    board = ch[['m', 'k', 'r', 'bid', 'ask']].copy()
    board['m'] = board.m.astype(int)
    fl = B.flow(D)
    tick = {'SPXW': ('SPXW', 'SPX')}.get(root, (root,))
    fl = chase_flag(fl[fl.ticker.isin(tick)].copy(), D) if len(fl) else None
    nw = B.news(D)
    d = RU.Day(root, iso(D), bars, board, x=x, volix=volix_study(D, root), flow=fl, news=nw if len(nw) else None)
    d.exp = iso(e0)
    d.study_D = D
    return d


_DEVFLOW = {}


def dev_flow(root, day):
    """UW flow alerts (EDGE-B's DEV cache: ask-side, OTM, <= 7 DTE, >= $100k) published on the day, ET seconds."""
    if not _DEVFLOW:
        from zoneinfo import ZoneInfo
        ny = ZoneInfo('America/New_York')
        rows = []
        for f in ('flow_DEV_0', 'flow_DEV_1'):
            for line in gzip.open(os.path.join(B.DATA, 'edge-b', 'uw', f + '.jsonl.gz'), 'rt'):
                r = json.loads(line)
                if r.get('ticker') not in ('SPY', 'QQQ', 'IWM'):
                    continue
                t = dt.datetime.fromisoformat(r['created_at'].replace('Z', '+00:00')).astimezone(ny)
                tp = float(r.get('total_premium') or 0)
                rows.append({'day': t.date().isoformat(), 'ticker': r['ticker'],
                             's': t.hour * 3600 + t.minute * 60 + t.second + t.microsecond / 1e6, 'type': r['type'],
                             'prem': tp, 'ask_prem': float(r.get('total_ask_side_prem') or 0), 'id': r.get('id')})
        df = pd.DataFrame(rows).drop_duplicates('id')
        df['chase'] = df.ask_prem >= 0.5 * df.prem
        for (d_, tk), g in df.groupby(['day', 'ticker']):
            _DEVFLOW[(d_, tk)] = g.sort_values('s').reset_index(drop=True)
        _DEVFLOW['_days'] = (df.day.min(), df.day.max())
    lo, hi = _DEVFLOW['_days']
    if root not in ('SPY', 'QQQ', 'IWM') or not (lo <= day <= hi):
        return None
    return _DEVFLOW.get((day, root), pd.DataFrame(columns=['s', 'type', 'prem', 'ask_prem', 'chase']))


_EXPS = {}


def first_exp(root, day):
    if root not in _EXPS:
        _EXPS[root] = sorted(json.load(open(os.path.join(B.DATA, 'edge', f'exp_{root}.json'))))
    ex = [e for e in _EXPS[root] if e >= day]
    return ex[0] if ex else None


_VIXDEV = {}


def dev_volix(root, day):
    """The root's 30-day vol index 1-minute prints on a DEV day (cached in v2data/nov5-broad/volix)."""
    sym = VOLIX[root]
    f = os.path.join(B.OUT, 'volix', sym, f'{day}.parquet')
    if not os.path.exists(f):
        if DS.NOFETCH:
            return {}
        import fetch_tape as FT
        try:
            p = FT.csv('/index/history/price', {'symbol': sym, 'date': day.replace('-', ''), 'interval': '1m'})
            df = pd.DataFrame({'m': (FT.ms_of(p.timestamp) // 60000).astype(int), 'px': p.price.astype(float)})
        except FT.NoData:
            df = pd.DataFrame({'m': [], 'px': []})
        os.makedirs(os.path.dirname(f), exist_ok=True)
        df.to_parquet(f + '.tmp', index=False)
        os.replace(f + '.tmp', f)
    df = pd.read_parquet(f)
    df = df[df.px > 0]
    return dict(zip(df.m.astype(int), df.px.astype(float)))


def dev_day(root, day, need_volix=True):
    EC.assert_open(day) if hasattr(EC, 'assert_open') else None
    bars = esim.day_bars(root, day)
    ch = esim.chain(root, day)
    if ch is None or len(bars) < 300 or not len(ch) or 'bid' not in ch.columns:
        return None                             # an empty cached chain file (EDGE wrote some): no board, no session
    exp = first_exp(root, day)
    if exp is None:
        return None
    x = int(np.busday_count(pd.Timestamp(day).date(), pd.Timestamp(exp).date()))
    board = ch[['m', 'k', 'r', 'bid', 'ask']].copy()
    vx = dev_volix(root, day) if (need_volix and x == 0) else {}
    d = RU.Day(root, day, bars[['m', 'o', 'h', 'l', 'c']], board, x=x, volix=vx, flow=dev_flow(root, day))
    d.exp = exp
    d.study_D = None
    return d


# ---------------------------------------------------------------- the mechanism exit (XR)


def xr_time(d, ev, side):
    t = int(ev['t'])
    m_end = min(t + 5400, DS.FLAT_S) // 60
    rule = ev['rule']
    for m in range(t // 60 + 1, m_end + 1):
        c = d.c[m - 1 - RU.M0]
        s = d.s(m - 1)
        if not np.isfinite(c):
            continue
        if rule == 'R1' and ((np.isfinite(s) and s >= ev['sig_pk']) or c < ev['lo30']):
            return m * 60
        if rule == 'R2' and ((np.isfinite(s) and s <= ev['sig_tr']) or c > ev['hi30']):
            return m * 60
        if rule == 'R4' and ((ev['side'] > 0 and c < ev['lo30']) or (ev['side'] < 0 and c > ev['hi30'])):
            return m * 60
    return None


# ---------------------------------------------------------------- one event


def _path(d, k, call, start, end):
    if hasattr(d, 'synth'):                     # bnullsyn.py: the synthetic session's own quotes
        return d.synth.path(k, call, start, end)
    return BS.get_path(d.root, d.day, d.exp, k, call, start, end, d.study_D)


def simulate_event(d, ev, side, long_only=False):
    t = int(ev['t'])
    start, end = max(t - PRE, 9 * 3600 + 31 * 60), min(t + WIN, DS.END_CAP)
    rows = []
    if ev['rule'] == 'R3':
        pair = BS.pick_atm_pair(d.board, d.bars, t, d.x)
        if pair is None:
            return [{'expr': e, 'exit_rule': 'XP', 'skip': 'no ATM pair'} for e in EXPRS]
        end = DS.END_CAP
        pc = _path(d, pair['C']['k'], True, start, end)
        pp = _path(d, pair['P']['k'], False, start, end)
        if pc is None or pp is None:
            return [{'expr': e, 'exit_rule': 'XP', 'skip': 'no path'} for e in EXPRS]
        r = BS.simulate_xp(BS.combine([pc, pp], [1, 1]), t, 2)
        rows.append({'expr': 'L', 'exit_rule': 'XP', 'k': pair['C']['k'], 'k2': np.nan, **r})
        if long_only:
            return rows
        shorts = []
        for nm in ('C', 'P'):
            pk = {**pair[nm], 'delta': 0.50}
            shorts.append(BS.pick_short(d.board, d.bars, t, pk, d.x))
        if any(s is None for s in shorts):
            rows.append({'expr': 'S', 'exit_rule': 'XP', 'skip': 'no short leg'})
        else:
            sc = _path(d, shorts[0]['k'], True, start, end)
            sp = _path(d, shorts[1]['k'], False, start, end)
            if sc is None or sp is None:
                rows.append({'expr': 'S', 'exit_rule': 'XP', 'skip': 'no path'})
            else:
                r = BS.simulate_xp(BS.combine([pc, pp, sc, sp], [1, 1, -1, -1]), t, 4)
                rows.append({'expr': 'S', 'exit_rule': 'XP', 'k': pair['C']['k'], 'k2': shorts[0]['k'],
                             'k3': shorts[1]['k'], **r})
        return rows
    pk, why = BS.pick(d.board, d.bars, d.day, t, side > 0, TARGET, d.x)
    exits = EXITS[ev['rule']]
    if pk is None:
        return [{'expr': e, 'exit_rule': x, 'skip': why} for e in EXPRS for x in exits]
    p1 = _path(d, pk['k'], pk['call'], start, end)
    if p1 is None:
        return [{'expr': e, 'exit_rule': x, 'skip': 'no path', **pk} for e in EXPRS for x in exits]
    sh = BS.pick_short(d.board, d.bars, t, pk, d.x)
    p2 = _path(d, sh['k'], sh['call'], start, end) if sh else None
    tx = xr_time(d, ev, side) if 'XR' in exits else None
    for e in EXPRS:
        if e == 'L':
            path, pkk, legs = p1, pk, 1
        else:
            if sh is None or p2 is None:
                rows += [{'expr': 'S', 'exit_rule': x, 'skip': 'no short leg' if sh is None else 'no path', **pk} for x in exits]
                continue
            path, legs = BS.combine([p1, p2], [1, -1]), 2
            pkk = {**pk, 'delta': pk['delta'] - sh['delta']}
        for x in exits:
            if x == 'XB':
                r = DS.simulate(path, t, 'XB', pkk, ev['S'], ev['atm'], ev['rv'] if np.isfinite(ev['rv']) else ev['atm'])
            else:
                r = BS.simulate_xr(path, t, pkk, ev['S'], ev['atm'], tx)
            r = BS.refee(r, legs)
            rows.append({'expr': e, 'exit_rule': x, **pk, 'k2': sh['k'] if (sh and e == 'S') else np.nan,
                         'd2': sh['delta'] if (sh and e == 'S') else np.nan, **r})
    return rows


def run_day(d, sides=('real',), rules=('R1', 'R2', 'R3', 'R4', 'R5')):
    out = []
    for ev in RU.events(d, rules):
        for sd in sides:
            if sd == 'flip' and ev['rule'] == 'R3':
                continue
            side = ev['side'] if sd == 'real' else -ev['side']
            for r in simulate_event(d, ev, side):
                out.append({'root': d.root, 'day': d.day, 'exp': d.exp, 'x': d.x, 'rule': ev['rule'], 't': int(ev['t']),
                            'ev_side': int(ev['side']), 'side': int(side), 'sideset': sd, 'S': ev['S'], 'atm': ev['atm'],
                            'variant': f"{ev['rule']}-{r['exit_rule']}-{r['expr']}",
                            **{k: v for k, v in ev.items() if k in ('rho', 'sig_pk', 'sig_ref', 'sig_tr', 'chase',
                                                                     'other', 'base15', 'headline')},
                            **r})
    return out


def atomic_json(obj, f):
    os.makedirs(os.path.dirname(f), exist_ok=True)
    with open(f + '.tmp', 'w') as fh:
        json.dump(obj, fh, default=lambda o: o.item() if hasattr(o, 'item') else str(o))
    os.replace(f + '.tmp', f)


def main():
    cmd = sys.argv[1]
    if cmd == 'day':
        D = sys.argv[2]
        DS.NOFETCH = '--nofetch' in sys.argv
        rows = []
        for root in sys.argv[3].split(','):
            d = study_day(D, root)
            rows += run_day(d, sides=('real', 'flip'))
        atomic_json(rows, os.path.join(RES, 'days', f'{D}.json'))
        df = pd.DataFrame(rows)
        if not len(df):
            print(D, 'no trigger')
            return
        pd.set_option('display.width', 260); pd.set_option('display.max_rows', 400)
        cols = ['root', 'variant', 'sideset', 't', 'side', 'k', 'k2', 'delta', 'fill', 'exit', 'reason', 'entry_s',
                'exit_s', 'ret_net', 'pnl_net', 'src', 'skip']
        print(df[[c for c in cols if c in df.columns]].assign(
            t=lambda x: [B.clock(v) for v in x.t],
            entry_s=lambda x: [B.clock(v) if pd.notna(v) else '' for v in x.get('entry_s', [np.nan] * len(x))],
            exit_s=lambda x: [B.clock(v) if pd.notna(v) else '' for v in x.get('exit_s', [np.nan] * len(x))]).to_string())
        return
    if cmd == 'r3ref':
        # PREREG key null for R3: the same straddle on a seeded sample of 200 same-day-expiry root-sessions, rho > 0.60
        days = EC.dev_sessions('DEV')
        cand = []
        for day in days:
            assert EC.split_of(day) == 'DEV', day
            for root in DEV_ROOTS:
                f = os.path.join(B.OUT, 'volix', VOLIX[root], f'{day}.parquet')
                if not os.path.exists(f) or not os.path.exists(os.path.join(RES, 'dev', f'{root}_{day}.json')):
                    continue
                cand.append((root, day))
        rng = np.random.default_rng(20261108)
        rng.shuffle(cand)
        n = 0
        for root, day in cand:
            if n >= 200:
                break
            f = os.path.join(RES, 'dev_r3ref', f'{root}_{day}.json')
            if os.path.exists(f):
                n += 1
                continue
            d = dev_day(root, day)
            if d is None or d.x != 0:
                continue
            s0, v = d.s(575), d.volix.get(575)
            if not (np.isfinite(s0) and v and v > 0) or s0 / (v / 100) <= 0.60:
                continue
            ev = {'rule': 'R3', 't': 576 * 60, 'side': 0, 'S': d.S(576), 'atm': s0, 'rv': np.nan, 'rho': s0 / (v / 100)}
            rows = [{'root': root, 'day': day, 'exp': d.exp, 'x': d.x, 'rule': 'R3ref', 't': 576 * 60, 'rho': ev['rho'],
                     'variant': f"R3ref-{r['exit_rule']}-{r['expr']}", **r} for r in simulate_event(d, ev, 0, long_only=True)]
            atomic_json(rows, f)
            n += 1
        print('r3ref done', n, flush=True)
        return
    if cmd == 'dev':
        DS.NOFETCH = '--nofetch' in sys.argv
        lim = [a for a in sys.argv[2:] if a.replace('.', '').isdigit()]
        tmax = float(lim[0]) * 60 if lim else 1e12
        flip = '--flip' in sys.argv
        tag = 'dev_flip' if flip else 'dev'
        days = EC.dev_sessions('DEV')
        rng = np.random.default_rng(20261107)
        order = [days[i] for i in rng.permutation(len(days))]
        if '--reverse' in sys.argv:         # a second worker walks the same seeded order from the other end
            order = order[::-1]
        t0, n = time.time(), 0
        for day in order:
            assert EC.split_of(day) == 'DEV', day
            for root in DEV_ROOTS:
                f = os.path.join(RES, tag, f'{root}_{day}.json')
                if os.path.exists(f):
                    continue
                if not os.path.exists(os.path.join(B.DATA, 'edge', 'chain', root, f'{day}.parquet')):
                    continue
                d = dev_day(root, day)
                if d is None:
                    atomic_json([], f)
                    continue
                rows = run_day(d, sides=('flip',) if flip else ('real',), rules=('R1', 'R2', 'R3', 'R4'))
                atomic_json(rows, f)
            n += 1
            if n % 10 == 0:
                print(time.strftime('%H:%M:%S'), tag, n, len(order), DS.PSTATS, flush=True)
            if time.time() - t0 > tmax:
                print('time cut', n, flush=True)
                break
        print('done', tag, n, DS.PSTATS, flush=True)


if __name__ == '__main__':
    main()
