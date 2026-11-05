"""Attack 2/6/7: fill realism, capacity and quote genuineness on the 59 locked calls' 1-second NBBO (the blind scorer's
cache: state changes 00:00-09:30 ET)."""
import os, json, numpy as np, pandas as pd, rt

E = rt.locked_exec()
rows = []
for c in E['calls']:
    day = c['day']; con = c['contract'].split()  # 'SPXW 20220603 4120P'
    exp, sk = con[1], con[2]
    f = os.path.join(rt.Q1S, f"{day}_{exp}_{float(sk[:-1]):g}{sk[-1]}.parquet")
    q = pd.read_parquet(f)
    q = q.sort_values('ms').reset_index(drop=True)
    ms, bid, ask, bs, as_ = q.ms.values, q.bid.values / 100, q.ask.values / 100, q.bs.values, q['as'].values
    valid = (ask > 0) & (bid >= 0)
    night = (ms >= 0) & (ms < 6 * 3600_000) & valid
    spread = ask - bid
    mid = (ask + bid) / 2
    rel = np.where(mid > 0, spread / mid, np.nan)
    dur = np.r_[np.diff(ms), 0].astype(float)

    def tw(x, m):
        w = dur[m]; v = x[m]; ok = np.isfinite(v) & (w > 0)
        if not ok.any():
            return np.nan, np.nan
        o = np.argsort(v[ok]); cw = np.cumsum(w[ok][o]) / w[ok].sum()
        return float(v[ok][o][min(np.searchsorted(cw, 0.5), ok.sum() - 1)]), float(v[ok][o][min(np.searchsorted(cw, 0.95), ok.sum() - 1)])
    sp_med, sp_95 = tw(spread, night); rel_med, rel_95 = tw(rel, night)
    locked = ((ask <= bid) & valid & (ms < 6 * 3600_000)).sum()
    crossed = ((ask < bid) & valid & (ms < 6 * 3600_000)).sum()
    zero_ask_sz = float((dur[night & (as_ < 1)].sum()) / max(dur[night].sum(), 1))
    e = c.get('entry_ms')
    if e is None:
        rows.append(dict(day=day, contract=c['contract'], rejected=True)); continue
    i = np.searchsorted(ms, e, side='right') - 1
    j = i
    while j > 0 and ask[j - 1] == ask[i]:
        j -= 1
    stale_s = (e - ms[j]) / 1000
    nxt = ask[i + 1:i + 6]
    fill = c['fill']
    rows.append(dict(day=day, contract=c['contract'], mark=c['mark'], fill=fill, entry_ask_size=c['entry_ask_size'], bid_at_entry=bid[i], ask_at_entry=ask[i],
                     spread_at_entry=ask[i] - bid[i], rel_spread_entry=(ask[i] - bid[i]) / fill, stale_s=stale_s,
                     next5_ask_min=float(nxt.min()) if len(nxt) else np.nan, next5_ask_max=float(nxt.max()) if len(nxt) else np.nan,
                     next5_ask_med=float(np.median(nxt)) if len(nxt) else np.nan, secs_to_5th=(ms[min(i + 5, len(ms) - 1)] - e) / 1000,
                     night_spread_med=sp_med, night_spread_95=sp_95, night_rel_med=rel_med, night_rel_95=rel_95,
                     locked=int(locked), crossed=int(crossed), frac_time_ask_size0=zero_ask_sz,
                     n_changes_night=int(night.sum()), n_changes_total=int(valid.sum()),
                     reason=c['reason'], ret_net=c['ret_net']))
t = pd.DataFrame(rows)
pd.set_option('display.width', 250)
print(t.drop(columns=['contract']).round(3).to_string())
print('\n--- summary (59 calls) ---')
print('spread at entry $: median %.2f, 95th %.2f; relative to fill: median %.1f%%, 95th %.1f%%' % (t.spread_at_entry.median(), t.spread_at_entry.quantile(.95), 100 * t.rel_spread_entry.median(), 100 * t.rel_spread_entry.quantile(.95)))
print('night (00-06) time-weighted spread $: median of medians %.2f, median of 95ths %.2f; rel: %.1f%% / %.1f%%' % (t.night_spread_med.median(), t.night_spread_95.median(), 100 * t.night_rel_med.median(), 100 * t.night_rel_95.median()))
print('displayed ask size at fill: median %d, min %d, <5: %d, <10: %d' % (t.entry_ask_size.median(), t.entry_ask_size.min(), (t.entry_ask_size < 5).sum(), (t.entry_ask_size < 10).sum()))
print('fraction of night time with ask size 0: median %.3f max %.3f' % (t.frac_time_ask_size0.median(), t.frac_time_ask_size0.max()))
print('locked quotes (00-06): %d, crossed: %d over %d state changes' % (t.locked.sum(), t.crossed.sum(), t.n_changes_night.sum()))
print('ask unchanged > 60 s at entry: %d/59 (median stale %.0f s, 95th %.0f s)' % ((t.stale_s > 60).sum(), t.stale_s.median(), t.stale_s.quantile(.95)))
print('next-5-ticks: min of next5 above fill in %d, min of next5 below fill in %d, median next5 - fill = %.3f (%.1f%% of fill); median secs to 5th change %.0f' % ((t.next5_ask_min > t.fill).sum(), (t.next5_ask_min < t.fill).sum(), (t.next5_ask_med - t.fill).median(), 100 * ((t.next5_ask_med - t.fill) / t.fill).median(), t.secs_to_5th.median()))
print('quote state changes per night 00-06 per contract: median %d' % t.n_changes_night.median())
for k in (1, 5, 10):
    print(f'{k} contract(s) per user x 200 users = {200*k}: nights where displayed ask size >= {200*k}: {(t.entry_ask_size >= 200*k).sum()}/59; >= {k} (one user): {(t.entry_ask_size >= k).sum()}/59')
t.to_csv('a2_fills.csv', index=False)
