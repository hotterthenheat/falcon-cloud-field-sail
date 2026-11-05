"""
Nov 4 research: every enterable contract-mark of the regular session, its outcome, and its pre-entry signature.

A contract-mark = one contract of a fetched chain (fetch.py) at one 5-minute mark M from 09:35 to 15:00.
Enterable: the quote standing at M passes Compass's spread gate (bid > 0.15, (ask-bid)/mid <= 8%) and the next
minute has a valid ask (the fill: the ask at M+1, as the ledger fills a call).
Outcome (1-minute NBBO, from M+2 to 15:55): win = the bid reaches 1.5x the fill before it falls to 0.4678x the fill;
return = +50% on a win, (bid at the stop minute / fill - 1) on a stop, (bid at 15:55 / fill - 1) otherwise.
Also: the best bid / fill before 15:55 (the "ran" multiple, stop or not), and the minute it peaked.

Every feature is computed from data stamped at or before M (quotes at M, bars that closed by M). Nothing after M.

  python3 -I research/nov4/features.py 2026-11-04 ...     -> $NOV4_DATA/rows_<day>.parquet
"""
import glob, math, os, sys
import numpy as np
import pandas as pd

DATA = os.environ.get('NOV4_DATA', '/tmp/claude-0/-home-user/f71fb141-33a0-5344-9573-1a2ad4706812/scratchpad/nov4data')
R = 0.042
STOP = 1 - 0.5322
FLAT = 385          # 15:55, minutes from 09:30
MARKS = list(range(5, 331, 5))  # 09:35 .. 15:00
INDEX_UNDER = {'SPXW': 'SPX', 'XSP': 'SPX', 'NDXP': 'NDX', 'RUTW': 'RUT', 'VIX': 'VIX'}
SPAN_INDEX = {'SPXW', 'NDXP', 'XSP', 'RUTW', 'SPY', 'QQQ', 'IWM'}


from scipy.special import ndtr


def ncdf(x):
    return ndtr(x)


def npdf(x):
    return np.exp(-0.5 * x * x) / math.sqrt(2 * math.pi)


def black(F, K, T, vol, cp):
    s = vol * np.sqrt(T)
    d1 = (np.log(F / K) + 0.5 * s * s) / s
    d2 = d1 - s
    df = math.exp(-R * T) if np.isscalar(T) else np.exp(-R * T)
    if cp == 'C':
        return df * (F * ncdf(d1) - K * ncdf(d2)), df * ncdf(d1), d1
    return df * (K * ncdf(-d2) - F * ncdf(-d1)), -df * ncdf(-d1), d1


def implied(price, F, K, T, cp):
    lo, hi = np.full_like(price, 0.01), np.full_like(price, 8.0)
    for _ in range(50):
        mid = 0.5 * (lo + hi)
        p, _, _ = black(F, K, T, mid, cp)
        hi = np.where(p > price, mid, hi)
        lo = np.where(p > price, lo, mid)
    v = 0.5 * (lo + hi)
    intrinsic = math.exp(-R * T) * np.maximum(0.0, (F - K) if cp == 'C' else (K - F))
    return np.where(price > intrinsic + 1e-4, v, np.nan)


def weekday_dte(day, exp):
    import datetime
    a, b = datetime.date.fromisoformat(day), datetime.date.fromisoformat(exp)
    n, d = 0, a
    while d < b:
        d += datetime.timedelta(days=1)
        if d.weekday() < 5:
            n += 1
    return n


def years(m, dte):
    return (max(1, 390 - m) + dte * 390) / (390 * 252)


def load_under(day, root):
    u = INDEX_UNDER.get(root, root)
    f = os.path.join(DATA, f'{day}_U_{u}.npz')
    if not os.path.exists(f):
        return None
    z = np.load(f)
    d = {k: z[k].astype(float) for k in z.files}
    for k in ('o', 'h', 'l', 'c', 'vwap'):
        d[k] = np.where(d[k] > 0, d[k], np.nan)
    if root == 'XSP':
        for k in ('o', 'h', 'l', 'c', 'vwap', 'prev_close'):
            d[k] = d[k] / 10
    return d


def under_feats(U, m):
    """Underlying features at mark m (bars 0..m-1 have closed)."""
    c = U['c'][:m]
    ok = np.isfinite(c) & (c > 0)
    if ok.sum() < 3:
        return None
    c = pd.Series(c).ffill().values
    spot = c[-1]
    lr = np.diff(np.log(c))
    rv30 = np.nanstd(lr[-30:]) * math.sqrt(390 * 252) if len(lr) >= 5 else np.nan
    hi = np.nanmax(U['h'][:m]); lo = np.nanmin(U['l'][:m])
    o0 = U['o'][0] if np.isfinite(U['o'][0]) and U['o'][0] > 0 else c[0]
    v = U['v'][:m]; vw = U['vwap'][:m]
    if np.nansum(v) > 0 and np.nanmax(vw) > 0:
        vwap = np.nansum(v * vw) / np.nansum(v)
    else:  # an index has no volume: the mean of the typical price
        vwap = np.nanmean((U['h'][:m] + U['l'][:m] + c) / 3)
    pc = U['prev_close'][0]
    ret = lambda k: (spot / c[-1 - k] - 1) if len(c) > k else np.nan
    return dict(spot=spot, u_r5=ret(5), u_r15=ret(15), u_r30=ret(30), u_open=spot / o0 - 1,
                u_gap=(o0 / pc - 1) if pc > 0 else np.nan, u_vwap=spot / vwap - 1,
                u_rangepos=(spot - lo) / (hi - lo) if hi > lo else 0.5, u_range=(hi - lo) / spot, rv30=rv30)


def forward(K, right, bid, ask, m, T):
    """Put-call parity forward from the strike nearest the money with both sides quoted at minute m."""
    best = None
    for k in np.unique(K):
        ic = np.where((K == k) & (right == 'C'))[0]; ip = np.where((K == k) & (right == 'P'))[0]
        if not len(ic) or not len(ip):
            continue
        cb, ca, pb, pa = bid[ic[0], m], ask[ic[0], m], bid[ip[0], m], ask[ip[0], m]
        if not (ca > 0 and pa > 0 and cb > 0 and pb > 0):
            continue
        cm, pm = (cb + ca) / 2, (pb + pa) / 2
        diff = abs(cm - pm)
        if best is None or diff < best[0]:
            best = (diff, k + (cm - pm) * math.exp(R * T))
    return best[1] if best else np.nan


def build_day(day):
    rows = []
    files = sorted(glob.glob(os.path.join(DATA, f'{day}_*_*.npz')))
    for f in files:
        base = os.path.basename(f)[:-4].split('_')
        if base[1] == 'U':
            continue
        root, exp = base[1], base[2]
        z = np.load(f, allow_pickle=False)
        if 'empty' in z.files:
            continue
        K, right = z['strike'].astype(float), z['right'].astype(str)
        bid, ask = z['bid'].astype(float), z['ask'].astype(float)
        vol, vwapo, close = np.nan_to_num(z['vol'].astype(float)), z['vwap'].astype(float), z['close'].astype(float)
        oi, oip = z['oi'].astype(float), z['oi_prev'].astype(float)
        U = load_under(day, root)
        if U is None:
            continue
        dte = weekday_dte(day, exp)
        sleeve = 'odte' if dte == 0 else 'weekly'
        mid = (bid + ask) / 2
        # aggressor proxy per bar t (bar t = minute t..t+1): bar close vs the mid standing at t+1, in half-spreads
        hs = np.maximum((ask - bid) / 2, 0.005)
        mid_next = np.roll(mid, -1, axis=1); hs_next = np.roll(hs, -1, axis=1)
        aggr = np.clip((close - mid_next) / hs_next, -1.5, 1.5)
        aggr = np.where(np.isfinite(aggr) & (vol > 0), aggr, 0.0)
        prem = vol * np.nan_to_num(vwapo) * 100  # $ premium traded per bar
        cumvol = np.cumsum(vol, axis=1)
        strikes = np.unique(K)
        step = np.median(np.diff(strikes)) if len(strikes) > 1 else 1.0
        for m in MARKS:
            if m + 2 > FLAT:
                continue
            T = years(m, dte)
            uf = under_feats(U, m)
            if uf is None:
                continue
            F = forward(K, right, bid, ask, m, T)
            if not (np.isfinite(F) and F > 0 and (root == 'VIX' or abs(F / uf['spot'] - 1) < 0.05)):
                F = uf['spot'] * math.exp(R * T)
            # chain flow over the last 15 bars (m-15 .. m-1), signed: call premium bought minus put premium bought
            sl = slice(max(0, m - 15), m)
            callm, putm = right == 'C', right == 'P'
            buyprem = (prem[:, sl] * aggr[:, sl]).sum(axis=1)
            chain_call = buyprem[callm].sum(); chain_put = buyprem[putm].sum()
            chain_prem15 = prem[:, sl].sum()
            chain_prem_all = prem[:, :m].sum()
            chain_burst = chain_prem15 / (chain_prem_all / m * 15) if chain_prem_all > 0 else np.nan
            # ATM IV from the strike nearest the forward
            iv_at = {}
            for cp in ('C', 'P'):
                ii = np.where(right == cp)[0]
                pr = mid[ii, m]
                good = (bid[ii, m] > 0) & (ask[ii, m] > 0)
                ivs = np.full(len(ii), np.nan)
                if good.any():
                    ivs[good] = implied(pr[good], F, K[ii][good], T, cp)
                for j, i in enumerate(ii):
                    iv_at[i] = ivs[j]
            atm_i = sorted(iv_at, key=lambda i: abs(K[i] - F))
            atm_iv = np.nanmean([iv_at[i] for i in atm_i[:4] if np.isfinite(iv_at[i])]) if atm_i else np.nan
            # gamma exposure from this expiry's OI (dealer convention: + calls, - puts), at the spot and on a grid
            gam = np.zeros(len(K))
            for i in range(len(K)):
                v = iv_at.get(i, np.nan)
                if not np.isfinite(v) or not np.isfinite(oi[i]):
                    continue
                s = v * math.sqrt(T)
                d1 = (math.log(F / K[i]) + 0.5 * s * s) / s
                gam[i] = math.exp(-0.5 * d1 * d1) / math.sqrt(2 * math.pi) / (F * s) * oi[i] * (1 if right[i] == 'C' else -1)
            gex = gam.sum() * F * F * 0.01 * 100
            # flip: the nearest level within +-3% where the net gamma changes sign
            flip = np.nan
            grid = F * (1 + np.linspace(-0.03, 0.03, 61))
            ivv = np.array([iv_at.get(i, np.nan) for i in range(len(K))]); okg = np.isfinite(ivv) & np.isfinite(oi)
            if okg.any():
                s = ivv[okg] * math.sqrt(T)
                sign = np.where(right[okg] == 'C', 1, -1) * oi[okg]
                net = []
                for G in grid:
                    d1 = (np.log(G / K[okg]) + 0.5 * s * s) / s
                    net.append((np.exp(-0.5 * d1 * d1) / (G * s) * sign).sum())
                net = np.array(net)
                ch = np.where(np.sign(net[1:]) != np.sign(net[:-1]))[0]
                if len(ch):
                    lv = grid[ch]
                    flip = (lv[np.argmin(abs(lv - F))] / F) - 1
            em = atm_iv * math.sqrt(T) * F if np.isfinite(atm_iv) else np.nan  # expected move to expiry, points
            for i in range(len(K)):
                b, a = bid[i, m], ask[i, m]
                if not (b > 0.15 and a >= b and a > 0):
                    continue
                if (a - b) / ((a + b) / 2) > 0.08 + 1e-9:
                    continue
                fa, fb = ask[i, m + 1], bid[i, m + 1]
                if not (fa > 0 and fb >= 0 and fa >= fb):
                    continue
                cp = right[i]
                sgn = 1 if cp == 'C' else -1
                # outcome
                path = bid[i, m + 2:FLAT + 1]
                tp, st = 1.5 * fa, STOP * fa
                win, ret, exit_m = 0, np.nan, FLAT
                for j, x in enumerate(path):
                    if not np.isfinite(x):
                        continue
                    if x <= st:
                        ret = x / fa - 1; exit_m = m + 2 + j; break
                    if x >= tp:
                        win, ret, exit_m = 1, 0.5, m + 2 + j; break
                if not np.isfinite(ret):
                    last = path[np.isfinite(path)]
                    ret = (last[-1] / fa - 1) if len(last) else -1.0
                fin = path[np.isfinite(path)]
                ran = (fin.max() / fa) if len(fin) else 0.0
                peak_m = m + 2 + int(np.nanargmax(np.where(np.isfinite(path), path, -1))) if len(fin) else FLAT
                # stop-first: did the bid touch the stop before its peak?
                stopped_first = bool(len(fin) and np.any(np.where(np.isfinite(path[:peak_m - m - 2 + 1]), path[:peak_m - m - 2 + 1], 9e9) <= st))
                v = iv_at.get(i, np.nan)
                delta = np.nan
                if np.isfinite(v):
                    _, delta, _ = black(F, K[i], T, v, cp)
                    delta = float(delta)
                v15 = vol[i, max(0, m - 15):m].sum(); vall = cumvol[i, m - 1] if m > 0 else 0
                rows.append(dict(
                    day=day, root=root, exp=exp, dte=dte, sleeve=sleeve, strike=K[i], right=cp, m=m,
                    bid=b, ask=a, fill=fa, spread=(a - b) / ((a + b) / 2),
                    win=win, ret=ret, exit_m=exit_m, ran=ran, peak_m=peak_m, stopped_first=stopped_first,
                    delta=delta, absdelta=abs(delta) if np.isfinite(delta) else np.nan, iv=v, atm_iv=atm_iv,
                    iv_rel=(v / atm_iv) if np.isfinite(v) and atm_iv > 0 else np.nan,
                    rv_iv=uf['rv30'] / atm_iv if atm_iv > 0 else np.nan,
                    dist_strikes=(K[i] - F) / step * sgn,  # + = out of the money
                    otm_em=((K[i] - F) * sgn) / em if em and em > 0 else np.nan,
                    prem_em=a / em if em and em > 0 else np.nan,
                    s_r5=uf['u_r5'] * sgn, s_r15=uf['u_r15'] * sgn, s_r30=uf['u_r30'] * sgn, s_open=uf['u_open'] * sgn,
                    s_gap=uf['u_gap'] * sgn, s_vwap=uf['u_vwap'] * sgn,
                    s_rangepos=uf['u_rangepos'] if sgn > 0 else 1 - uf['u_rangepos'], u_range=uf['u_range'], rv30=uf['rv30'],
                    c_vol15=v15, c_volrate=(v15 / 15) / (vall / m) if vall > 0 else np.nan,
                    c_prem15=prem[i, max(0, m - 15):m].sum(),
                    c_aggr15=(aggr[i, max(0, m - 15):m] * vol[i, max(0, m - 15):m]).sum() / v15 if v15 > 0 else 0.0,
                    c_volu_oi=vall / oi[i] if oi[i] > 0 else np.nan, oi=oi[i],
                    oi_chg=(oi[i] - oip[i]) / max(oip[i], 1) if np.isfinite(oip[i]) and np.isfinite(oi[i]) else np.nan,
                    c_mid15=(mid[i, m] / mid[i, m - 15] - 1) if m >= 15 and mid[i, m - 15] > 0 else np.nan,
                    ch_flow=(chain_call - chain_put) * sgn / chain_prem15 if chain_prem15 > 0 else 0.0,
                    ch_burst=chain_burst, gex_sign=np.sign(gex), gex=gex, flip=flip * sgn if np.isfinite(flip) else np.nan,
                    flip_abs=abs(flip) if np.isfinite(flip) else np.nan,
                    # after the mark (labels only, never inputs): the underlying from M to the contract's peak and to 15:55
                    u_to_peak=(np.nanmax(U['c'][max(m, peak_m - 1):peak_m]) / uf['spot'] - 1) * sgn if peak_m > m else 0.0,
                    u_to_flat=(U['c'][FLAT - 1] / uf['spot'] - 1) * sgn if np.isfinite(U['c'][FLAT - 1]) else np.nan,
                ))
    return pd.DataFrame(rows)


if __name__ == '__main__':
    for day in [a for a in sys.argv[1:] if len(a) == 10]:
        df = build_day(day)
        out = os.path.join(DATA, f'rows_{day}.parquet')
        df.to_parquet(out)
        print(day, len(df), 'rows', out, flush=True)
