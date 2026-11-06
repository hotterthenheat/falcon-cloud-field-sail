"""STEP 3 - the turns of 2026-11-05 and what was visible strictly before each.

Turns (found in HINDSIGHT, only to place the snapshots):
  - SPX swing extremes: zigzag on the 1-second index with a 0.75% reversal threshold;
  - premium regime changes: the entry/exit seconds of the best 3 non-overlapping trades (ceiling.py DP) of the biggest
    winners.
Snapshot at each turn = the features row of the minute boundary at or before the turn (features.py: every input
stamped before that boundary), and the same 10 and 30 minutes earlier.

  python3 timeline.py 20261105 -> results/TIMELINE_<D>.md, results/timeline_<D>.png (chart; not committed)
"""
import math, os, sys
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import load  # noqa: E402
from features import ema  # noqa: E402

RES = os.path.join(HERE, 'results')


def zigzag(s, px, thr):
    """Alternating swing extremes: a high is confirmed once price falls thr below it (and vice versa)."""
    piv = []
    hi_i = lo_i = 0
    mode = 0
    for i in range(1, len(px)):
        if px[i] > px[hi_i]:
            hi_i = i
        if px[i] < px[lo_i]:
            lo_i = i
        if mode >= 0 and px[i] <= px[hi_i] * (1 - thr):
            piv.append(('H', hi_i)); mode = -1; lo_i = i
        elif mode <= 0 and px[i] >= px[lo_i] * (1 + thr):
            piv.append(('L', lo_i)); mode = 1; hi_i = i
    last = ('L', lo_i) if mode == -1 else ('H', hi_i)
    piv.append(last)
    out, prev = [], None
    for kind, i in piv:
        if prev and prev[0] == kind:
            if (kind == 'H' and px[i] > px[prev[1]]) or (kind == 'L' and px[i] < px[prev[1]]):
                out[-1] = (kind, i)
            prev = out[-1]
            continue
        out.append((kind, i)); prev = (kind, i)
    return [(k, int(s[i]), float(px[i])) for k, i in out]


def mid_series(ch, k, r):
    c = ch[(ch.k == k) & (ch.r == r)].sort_values('m')
    mid = np.where((c.bid > 0) & (c.ask >= c.bid), (c.bid + c.ask) / 2, np.nan)
    return pd.Series(mid, index=c.m.values)


def ema_state(ms, T):
    """EMA 9/21 of the 1-minute mid (stamps <= T-60) and of 5-minute mids (every 5th stamp), at decision time T."""
    x = ms[ms.index <= T // 60 - 1].dropna()
    if len(x) < 22:
        return ''
    v = x.values
    e9, e21 = ema(v, 9)[-1], ema(v, 21)[-1]
    x5 = x[x.index % 5 == 4]
    s5 = ''
    if len(x5) >= 22:
        f9, f21 = ema(x5.values, 9)[-1], ema(x5.values, 21)[-1]
        s5 = f" / 5m {'up' if f9 > f21 else 'dn'}"
    return f"{v[-1]:.2f} 1m {'up' if e9 > e21 else 'dn'} (9 {e9:.2f}, 21 {e21:.2f}){s5}"


def fmt_row(F, T, contract_ms, label):
    r = F[F['T'] <= T]
    if not len(r):
        return None
    r = r.iloc[-1]
    g = lambda c, f='{:.2f}': (f.format(r[c]) if c in r and pd.notna(r[c]) else '-')  # noqa: E731
    net = r.get('bk_net_all', np.nan)
    gs = '-' if pd.isna(net) else ('dealer SHORT' if net > 0 else 'dealer long')
    flip = r.get('bk_flip', np.nan)
    fd = '-' if pd.isna(flip) else f"{flip:.0f} ({(r['S'] - flip) / r['em_1h']:+.1f} EM1h)" if pd.notna(r.get('em_1h')) else f'{flip:.0f}'
    wu, wd = r.get('bk_wall_up', np.nan), r.get('bk_wall_dn', np.nan)
    walls = f"up {wu:.0f} / dn {wd:.0f}" if pd.notna(wu) and pd.notna(wd) else '-'
    pcr = r['vol_p15'] / max(r['vol_c15'], 1) if pd.notna(r.get('vol_p15')) else np.nan
    return {'when': label, 'T': load.clock(T), 'SPX': f"{r['S']:.1f}", 'from open': f"{100 * r['from_open']:+.2f}%",
            'r15': f"{100 * r['r15']:+.2f}%" if pd.notna(r['r15']) else '-', 'RV/IV': f"{g('rv_so_far')}/{g('atm_iv')} = {g('rv_iv')}",
            'skew25': g('skew25', '{:+.3f}'), 'VIX (15m chg)': f"{g('vix')} ({g('vix_chg15', '{:+.2f}')})",
            'IV 0D/1D': f"{g('atm_iv')}/{g('atm_iv_1d')}", 'gamma': gs, 'flip': fd, 'walls': walls,
            'P/C vol 15m': f'{pcr:.2f}' if pd.notna(pcr) else '-', 'top vol 15m': r.get('top_vol15', '-'),
            'UW 15m (n, put share, ask share)': f"{int(r.get('uw_n15', 0))}, {g('uw_put_share15')}, {g('uw_ask_share15')}",
            'last macro headline (30m)': r.get('news_last', '') or '-', 'Compass top': r.get('cmp_top', '-') or '-',
            'option': contract_ms}


def run(D):
    F = pd.read_parquet(os.path.join(load.ddir(D), 'features.parquet'))
    s, px = load.spx(D)
    turns = zigzag(s, px, 0.0075)
    ch = load.chain(D)
    ce = pd.read_parquet(os.path.join(RES, f'ceiling_{D}.parquet'))
    L = [f'# Turns of {D[:4]}-{D[4:6]}-{D[6:]} and what was visible before each\n',
         'Turns are located in hindsight (SPX zigzag, 0.75% reversal; and the best-3-trade legs of the biggest winners); '
         'every snapshot column uses only data stamped before the snapshot minute (see features.py). EM1h = 1-hour '
         'implied move from the 0DTE ATM IV. gamma = sign of the rebuilt book at spot (ALL expiries <= 31 days; '
         '"dealer SHORT" = dealers short gamma, hedging with the move). option = the next leg\'s 0.30-delta contract '
         '(chosen at the snapshot) with its 1-minute mid and EMA 9/21 state.\n']
    L.append('## SPX swing extremes (zigzag 0.75%)\n')
    L.append('| # | type | time | SPX | move to next |')
    L.append('|---|---|---|---:|---:|')
    for i, (k, t, p) in enumerate(turns):
        nxt = f'{100 * (turns[i + 1][2] / p - 1):+.2f}%' if i + 1 < len(turns) else '-'
        L.append(f'| {i} | {k} | {load.clock(t)} | {p:.2f} | {nxt} |')
    rows = []
    for i, (k, t, p) in enumerate(turns):
        T0 = (t // 60) * 60
        nxt_side = 0 if k == 'H' else 1          # after a high the next leg is down -> puts; after a low -> calls
        for lag, lab in ((30, '-30m'), (10, '-10m'), (0, 'at')):
            T = T0 - lag * 60
            if T < load.RTH0 + 60:
                continue
            b = ch[(ch.m == T // 60 - 1) & (ch.r == nxt_side) & (ch.bid > 0)]
            cms = '-'
            if len(b):
                j = np.argmin(np.abs(np.abs(b.delta.values) - 0.30))
                kk = float(b.k.values[j])
                cms = f"{kk:g}{'C' if nxt_side else 'P'} " + ema_state(mid_series(ch, kk, nxt_side), T)
            row = fmt_row(F, T, cms, f'{k}{i} {lab}')
            if row:
                rows.append(row)
    cols = list(rows[0].keys())
    L.append('\n## Snapshots before each turn (strictly-before-the-minute)\n')
    L.append('| ' + ' | '.join(cols) + ' |')
    L.append('|' + '---|' * len(cols))
    for r in rows:
        L.append('| ' + ' | '.join(str(r[c]).replace('|', '/') for c in cols) + ' |')
    # premium regime changes of the biggest winners
    L.append('\n## Premium regime changes of the biggest winners (best 3 non-overlapping trades, hindsight)\n')
    L.append('| contract | best single | legs (buy ask -> sell bid) |')
    L.append('|---|---:|---|')
    top = pd.concat([ce[ce.r == 0].nlargest(6, 'usd_gain'), ce[ce.r == 1].nlargest(4, 'usd_gain'),
                     ce[(ce.r == 0) & (ce.pct_buy >= 0.10)].nlargest(3, 'pct_mult')]).drop_duplicates(['k', 'r'])
    for _, x in top.iterrows():
        L.append(f"| {x.k:g}{'C' if x.r else 'P'} | ${x.usd_gain:,.0f} ({x.pct_mult:,.1f}x best multiple) | {x.k3_legs} |")
    open(os.path.join(RES, f'TIMELINE_{D}.md'), 'w').write('\n'.join(L) + '\n')
    chart(D, F, s, px, turns, ch)
    return '\n'.join(L)


def chart(D, F, s, px, turns, ch):
    try:
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt
    except Exception:
        return
    fig, ax = plt.subplots(4, 1, figsize=(14, 13), sharex=True, gridspec_kw={'height_ratios': [3, 1.2, 1.2, 1.6]})
    h = s / 3600
    ax[0].plot(h, px, lw=0.7, color='k', label='SPX (1 s)')
    Fh = F['T'] / 3600
    if 'bk_flip' in F:
        ax[0].plot(Fh, F.bk_flip, color='tab:purple', lw=1, label='flip (held, point in time)')
        ax[0].plot(Fh, F.bk_wall_dn, color='tab:red', lw=0.8, ls='--', label='largest |gamma| strike below')
        ax[0].plot(Fh, F.bk_wall_up, color='tab:green', lw=0.8, ls='--', label='largest |gamma| strike above')
    for k, t, p in turns:
        ax[0].annotate(f'{k} {load.clock(t)[:5]}\n{p:.0f}', (t / 3600, p), fontsize=8,
                       xytext=(0, 12 if k == 'H' else -24), textcoords='offset points', ha='center')
    ax[0].legend(fontsize=8, loc='upper right'); ax[0].set_ylabel('SPX')
    ax[1].plot(Fh, F.vix, label='VIX'); ax[1].set_ylabel('VIX')
    a2 = ax[1].twinx(); a2.plot(Fh, F.rv_iv, color='tab:orange', lw=0.8, label='RV so far / ATM IV'); a2.axhline(1, color='tab:orange', lw=0.5, ls=':')
    ax[2].plot(Fh, F.skew25, color='tab:brown', label='25d put IV - 25d call IV'); ax[2].set_ylabel('skew25')
    a3 = ax[2].twinx(); a3.plot(Fh, np.sign(F.bk_net_all), color='tab:purple', lw=0.8); a3.set_ylabel('gamma sign (+ = dealer short)')
    for k, c in ((7500, 'tab:red'), (7600, 'tab:orange'), (7450, 'tab:pink')):
        ms = mid_series(ch, k, 0)
        ax[3].semilogy(ms.index / 60, ms.values, color=c, label=f'{k}P mid (1m)')
    ms = mid_series(ch, 7400, 1)
    ax[3].semilogy(ms.index / 60, ms.values, color='tab:blue', label='7400C mid (1m)')
    ax[3].legend(fontsize=8); ax[3].set_xlabel('ET hour')
    fig.suptitle(f'SPXW {D}: SPX, rebuilt flip/walls, VIX, RV/IV, skew, gamma sign, premiums')
    fig.tight_layout()
    fig.savefig(os.path.join(RES, f'timeline_{D}.png'), dpi=110)


if __name__ == '__main__':
    print(run(sys.argv[1]))
