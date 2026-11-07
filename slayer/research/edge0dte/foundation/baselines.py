"""FOUNDATION task 5: baselines (PROTOCOL section 6) with the full reporting set (section 8), DISCOVERY and CALIBRATION
separately -> results/BASELINES.md, v2data/edge0dte/baselines.parquet

Contract rule (all option baselines): same-day expiry, 0.30-delta (|delta| nearest 0.30 within [0.15, 0.50], Black-76
on the board mid at t), ATM straddle = strike nearest the parity forward. Unconditional baselines enter at 10:00, 12:00
and 14:00; signal baselines at their decision time; exits at the 60-minute time stop and at the close (15:58 decision).
Fills: ask in / bid out at the first valid 1-second NBBO >= decision + 2 s, $0.65/contract/side/leg (lib.fills).

  no-trade         0 every session
  long call        0.30-delta call, every time
  long put         0.30-delta put, every time
  ATM straddle     ATM call + put, every time
  random side      call or put by coin flip per (session, time); 1,000 shuffles (seed 0..999); the full report is for
                   shuffle 0 and the shuffle distribution of expectancy / win / PF is given
  underlying B&H   long the underlying from S(t) to S(exit decision) (SPX index return for SPXW, no cost, labelled;
                   ETF share return, no cost), $1,000 notional per trade
  EMA 9/21         5-minute EMA9/EMA21 crossover -> 0.30-delta call (up) / put (down) at the cross (foundation/signals.py)
  ORB-30           first 5-minute close beyond the 09:30-10:00 range -> 0.30-delta call / put
  (EMA and ORB are also reported as underlying trades in the signal direction.)

Equity convention: each trade risks $1,000 of premium (fractional lots), P&L$ = ret * 1000; equity starts at $25,000;
max drawdown on that equity path (trades in time order); total return = sum P&L / 25,000; costs paid = (half-spreads in
and out + fees) at that scale. Sharpe per trade = mean/sd of ret; daily Sharpe = mean/sd of daily P&L over all
expiry sessions of the split (no-trade days = 0) * sqrt(252). Win = net ret > 0.
Regimes (fixed ex ante): GEX sign = total GEX at 09:45 (MODEL, same-day OI); VIX tercile = VIX at 09:45 vs the
DISCOVERY terciles of that series; trend/flat = |ln(S(09:45) / prior close)| > 0.5 * IV_atm(09:45) * sqrt(1/252)
("trend") else "flat" (the open's displacement relative to the board's one-day move).
"""
import math
import os

import numpy as np
import pandas as pd

from lib import cal
from lib.config import DATA, split
from lib.data import daily_closes
from lib.stats import boot_mean

OUT = os.path.join(os.path.dirname(__file__), '..', 'results', 'BASELINES.md')
EQ0, RISK = 25000.0, 1000.0


def regimes(root):
    p = pd.read_parquet(os.path.join(DATA, 'panel', f'{root}.parquet'))
    p = p[p.t == 35100][['day', 'gex_total', 'vix', 'S', 'iv_atm']].copy()
    dc = daily_closes(root)
    prev = []
    for d in p.day:
        x = dc[dc.index < d]
        prev.append(float(x.iloc[-1]) if len(x) else np.nan)
    p['prev_close'] = prev
    disc = p[p.day.map(split) == 'DISCOVERY'].vix.dropna()
    q1, q2 = np.percentile(disc, [100 / 3, 200 / 3]) if len(disc) else (np.nan, np.nan)
    p['gex'] = np.where(p.gex_total.isna(), 'n/a', np.where(p.gex_total > 0, 'GEX>0', 'GEX<0'))
    p['vixt'] = np.where(p.vix.isna(), 'n/a', np.where(p.vix <= q1, 'VIX low', np.where(p.vix <= q2, 'VIX mid', 'VIX high')))
    disp = np.abs(np.log(p.S / p.prev_close)) / (p.iv_atm * math.sqrt(1 / 252))
    p['trend'] = np.where(disp.isna(), 'n/a', np.where(disp > 0.5, 'trend', 'flat'))
    return p.set_index('day')[['gex', 'vixt', 'trend']], (q1, q2)


def report(tr, sessions, label):
    """tr: DataFrame with day, t, ret (net), ret_fee130, ret_tick1, cost_rt, skip, bucket. sessions: list of days."""
    out = {'baseline': label, 'sessions': len(sessions)}
    ok = tr[tr.skip.isna() & tr.ret.notna()] if 'skip' in tr else tr[tr.ret.notna()]
    out['trades'] = len(ok)
    out['skips'] = int(tr.skip.notna().sum()) if 'skip' in tr else 0
    out['trade_sessions'] = ok.day.nunique()
    if not len(ok):
        return out
    r = ok.ret.values
    w, l = r[r > 0], r[r <= 0]
    m, lo, hi, p = boot_mean(r, ok.day.values)
    out.update({'win': float((r > 0).mean()), 'avg_win': float(w.mean()) if len(w) else np.nan,
                'avg_loss': float(l.mean()) if len(l) else np.nan, 'exp': m, 'exp_lo': lo, 'exp_hi': hi, 'p': p,
                'exp_usd_lot': float(ok.pnl.mean()) if 'pnl' in ok and ok.pnl.notna().any() else np.nan,
                'pf': float(w.sum() / -l.sum()) if len(l) and l.sum() < 0 else np.inf,
                'sharpe_trade': float(r.mean() / r.std(ddof=1)) if len(r) > 2 and r.std() > 0 else np.nan})
    o = ok.sort_values(['day', 't'])
    pnl = o.ret.values * RISK
    eq = EQ0 + np.cumsum(pnl)
    peak = np.maximum.accumulate(np.r_[EQ0, eq])[1:]
    dd = (peak - eq)
    out['maxdd_usd'] = float(dd.max())
    out['maxdd_pct'] = float((dd / peak).max())
    out['total_return'] = float(pnl.sum() / EQ0)
    out['costs_usd'] = float((o.cost_rt * RISK).sum()) if 'cost_rt' in o else 0.0
    daily = pd.Series(pnl, index=o.day.values).groupby(level=0).sum().reindex(sessions).fillna(0).values
    out['sharpe_daily'] = float(daily.mean() / daily.std(ddof=1) * math.sqrt(252)) if daily.std() > 0 else np.nan
    for k in ('ret_fee130', 'ret_tick1'):
        if k in ok:
            out['exp_' + k[4:]] = float(ok[k].mean())
    return out


def by(tr, col):
    ok = tr[tr.skip.isna() & tr.ret.notna()] if 'skip' in tr else tr[tr.ret.notna()]
    res = []
    for k, g in ok.groupby(col):
        m, lo, hi, _ = boot_mean(g.ret.values, g.day.values, n_boot=1000)
        res.append((k, len(g), g.day.nunique(), float((g.ret > 0).mean()), m, lo, hi))
    return res


def pct(x, nd=1):
    return '-' if x is None or not np.isfinite(x) else f'{100 * x:+.{nd}f}%'


def main():
    tr = pd.read_parquet(os.path.join(DATA, 'trades.parquet'))
    tr = tr[tr.split.isin(['DISCOVERY', 'CALIBRATION'])]
    roots = sorted(set(tr[tr.purpose == 'base'].root))
    rows, sections, shuffles = [], [], []
    for root in roots:
        reg, (q1, q2) = regimes(root)
        t0 = tr[tr.root == root]
        for spl in ('DISCOVERY', 'CALIBRATION'):
            sess = [d for d in cal.expiry_sessions(root, '2020-02-18', '2024-12-31') if split(d) == spl]
            for h in ('60', 'close'):
                b = t0[(t0.split == spl) & (t0.h == h)]
                base = b[b.purpose == 'base']
                defs = {
                    'no-trade': None,
                    'long call 0.30d': base[base.struct == 'call'],
                    'long put 0.30d': base[base.struct == 'put'],
                    'ATM straddle': base[base.struct == 'straddle'],
                }
                # random side, shuffle 0 reported in full; 1,000 shuffles summarised
                c_ = base[base.struct == 'call'].drop_duplicates(['day', 't']).set_index(['day', 't'])
                p_ = base[base.struct == 'put'].drop_duplicates(['day', 't']).set_index(['day', 't'])
                keys = c_.index.intersection(p_.index)
                c_, p_ = c_.loc[keys], p_.loc[keys]
                rc = np.where(c_.skip.isna(), c_.ret.values, np.nan)
                rp = np.where(p_.skip.isna(), p_.ret.values, np.nan)
                stats_sh = []
                for s in range(1000):
                    rng = np.random.default_rng(s)
                    side = rng.random(len(keys)) < 0.5
                    if s == 0:
                        defs['random side (shuffle 0)'] = pd.concat([c_[side], p_[~side]]).reset_index()
                    rr = np.where(side, rc, rp)
                    rr = rr[np.isfinite(rr)]
                    stats_sh.append((rr.mean(), (rr > 0).mean(), rr[rr > 0].sum() / -rr[rr <= 0].sum()))
                stats_sh = np.array(stats_sh)
                shuffles.append({'root': root, 'split': spl, 'h': h, 'exp_mean': stats_sh[:, 0].mean(),
                                 'exp_lo': np.percentile(stats_sh[:, 0], 2.5), 'exp_hi': np.percentile(stats_sh[:, 0], 97.5),
                                 'win_mean': stats_sh[:, 1].mean(), 'pf_mean': stats_sh[:, 2].mean()})
                u = base[base.struct == 'call'][['day', 't', 'bucket', 'u_ret']].rename(columns={'u_ret': 'ret'})
                u = u.assign(ret=np.exp(u.ret) - 1, skip=None, cost_rt=0.0)
                defs['underlying B&H (no cost)'] = u
                for sig in ('ema', 'orb'):
                    s_ = b[b.purpose == sig]
                    if len(s_):
                        defs[f'{sig.upper()} option 0.30d'] = s_
                        su = s_[['day', 't', 'bucket', 'u_ret', 'struct']].copy()
                        su['ret'] = np.exp(np.where(su.struct == 'call', su.u_ret, -su.u_ret)) - 1
                        su = su.assign(skip=None, cost_rt=0.0)
                        defs[f'{sig.upper()} underlying (no cost)'] = su
                for name, d in defs.items():
                    if d is None:
                        r = {'baseline': name, 'sessions': len(sess), 'trades': 0, 'skips': 0, 'exp': 0.0, 'exp_lo': 0.0,
                             'exp_hi': 0.0, 'total_return': 0.0, 'maxdd_usd': 0.0, 'costs_usd': 0.0}
                        rows.append({**r, 'root': root, 'split': spl, 'h': h})
                        continue
                    d = d.copy()
                    r = report(d, sess, name)
                    r.update({'root': root, 'split': spl, 'h': h})
                    rows.append(r)
                    d = d.join(reg, on='day')
                    d['year'] = d.day.str[:4]
                    r['by'] = {c: by(d, c) for c in ('year', 'gex', 'vixt', 'trend', 'bucket')}
                    sections.append(r)
    res = pd.DataFrame([{k: v for k, v in r.items() if k != 'by'} for r in rows])
    res.to_parquet(os.path.join(DATA, 'baselines.parquet'))
    write_md(res, sections, pd.DataFrame(shuffles))
    return res


def write_md(res, sections, sh):
    L = ['# EDGE0DTE baselines (PROTOCOL section 6, reporting set of section 8)', '', __doc__.split('\n', 2)[2].strip(), '']
    L += ['## Headline', '', 'Expectancy = mean net return per trade as % of premium, day-clustered bootstrap 95% CI (2,000 resamples). '
          'PF = profit factor. Max DD on the $25,000 / $1,000-per-trade equity path.', '']
    for spl in ('DISCOVERY', 'CALIBRATION'):
        L += [f'### {spl}', '', '| root | baseline | exit | sessions | trades | skips | win | avg win | avg loss | expectancy [95%] | $/lot | PF | Sharpe/trade | Sharpe daily | max DD $ (%) | total return | costs $ | exp @ $1.30 fee | exp @ +1 tick |',
              '|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|']
        for _, r in res[res.split == spl].iterrows():
            r = r.to_dict()
            if r['baseline'] == 'no-trade':
                L.append(f"| {r['root']} | no-trade | {r['h']} | {r['sessions']} | 0 | 0 | - | - | - | 0 | 0 | - | - | - | 0 | 0 | 0 | - | - |")
                continue
            L.append(f"| {r['root']} | {r['baseline']} | {r['h']} | {r['sessions']} | {r['trades']} | {r.get('skips', 0)} | "
                     f"{100 * r.get('win', np.nan):.1f}% | {pct(r.get('avg_win'))} | {pct(r.get('avg_loss'))} | "
                     f"{pct(r.get('exp'))} [{pct(r.get('exp_lo'))}, {pct(r.get('exp_hi'))}] | "
                     f"{r.get('exp_usd_lot', np.nan):+.1f} | {r.get('pf', np.nan):.2f} | {r.get('sharpe_trade', np.nan):+.3f} | "
                     f"{r.get('sharpe_daily', np.nan):+.2f} | {r.get('maxdd_usd', np.nan):,.0f} ({100 * r.get('maxdd_pct', np.nan):.0f}%) | "
                     f"{pct(r.get('total_return'), 0)} | {r.get('costs_usd', np.nan):,.0f} | {pct(r.get('exp_fee130'))} | {pct(r.get('exp_tick1'))} |")
        L.append('')
    L += ['## Random side: 1,000 shuffles', '', '| root | split | exit | mean expectancy | 2.5% .. 97.5% of shuffles | mean win | mean PF |', '|---|---|---|---:|---:|---:|---:|']
    for _, s in sh.iterrows():
        L.append(f"| {s.root} | {s.split} | {s.h} | {pct(s.exp_mean)} | {pct(s.exp_lo)} .. {pct(s.exp_hi)} | {100 * s.win_mean:.1f}% | {s.pf_mean:.2f} |")
    L += ['', '## Breakdowns (expectancy [95% CI], trades, win)', '']
    names = {'year': 'year', 'gex': 'GEX sign at 09:45 (MODEL)', 'vixt': 'VIX tercile at 09:45', 'trend': 'trend/flat by the open', 'bucket': 'time bucket'}
    for r in sections:
        L.append(f"### {r['root']} {r['split']} {r['baseline']} exit {r['h']}")
        L.append('')
        for c, rows in r['by'].items():
            L.append(f"- {names[c]}: " + '; '.join(f"{k}: {pct(m)} [{pct(lo)}, {pct(hi)}] n={n} win {100 * w:.0f}%" for k, n, nd, w, m, lo, hi in rows))
        L.append('')
    open(OUT, 'w').write('\n'.join(L) + '\n')


if __name__ == '__main__':
    main()
