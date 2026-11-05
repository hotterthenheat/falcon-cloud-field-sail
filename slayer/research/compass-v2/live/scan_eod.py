#!/usr/bin/env python3
import warnings; warnings.filterwarnings("ignore")
"""LIVE-SCAN end of day: labels every buyable contract-minute, compares the ones that later reached 1.5x with ALL
buyable contract-minutes (context at entry only), and writes the day's report.

Definitions (fixed before today's data was looked at in aggregate):
  buyable contract-minute: a candidate row (|delta| 0.10-0.60, ask >= 0.10, spread <= 15% of mid) in a minute snapshot;
                           entry = that snapshot's ASK.
  reached k x:             some LATER snapshot of the same contract (any delta) shows bid >= k * entry ask, before 16:00.
  confirmed:               the snapshot after the first hit also shows bid >= k * entry ask (guards single bad quotes).
  mover event:             movers.jsonl (written live): first time a contract's bid reached k x its running-min ask.
Context features come from ctx-HHMM (built live at HH:MM:01 from data we had then). Direction-signed copies
(dir_*) turn each feature into "for the option's side" (calls +, puts -).
"""
import csv, glob, gzip, json, math, os, sys
import numpy as np
import pandas as pd

DAY = sys.argv[1] if len(sys.argv) > 1 else '2026-11-05'
OUT = f'/home/user/falcon-cloud-field-sail/v2data/live/scan/{DAY}'
HERE = os.path.dirname(os.path.abspath(__file__))
REPORT = os.path.join(HERE, f'REPORT-{DAY}.md')
TIER_A = {'SPY', 'QQQ', 'IWM', 'SPXW', 'NVDA', 'TSLA', 'AAPL', 'AMD', 'META', 'AMZN', 'MSFT', 'GOOGL'}
K = [1.5, 2.0, 5.0]

def mod(m):
    m = str(m).zfill(4)
    return (int(m[:2]) * 60 + int(m[2:])) - 570

def load_chain():
    parts = []
    for p in sorted(glob.glob(f'{OUT}/chain-*.csv.gz')):
        try:
            parts.append(pd.read_csv(p, dtype={'minute': str, 'strike': str, 'exp': str}))
        except Exception:
            pass
    df = pd.concat(parts, ignore_index=True)
    df['mod'] = df['minute'].map(mod)
    for c in ['bid', 'ask', 'delta', 'iv', 'under', 'gamma_bs', 'bid_size', 'ask_size', 'theta', 'vega']:
        df[c] = pd.to_numeric(df[c], errors='coerce')
    df = df[(df['ask'] > 0) & (df['bid'] >= 0) & (df['bid'] <= df['ask'])]
    df['key'] = df['sym'] + ' ' + df['exp'] + ' ' + df['strike'] + df['right']
    return df.drop_duplicates(['key', 'mod'], keep='last')

def label(df):
    """per candidate row: max later bid multiple, first-hit minute for each k, confirmed flag"""
    out = []
    for key, g in df.groupby('key', sort=False):
        g = g.sort_values('mod')
        mods = g['mod'].to_numpy(); bids = g['bid'].to_numpy(); asks = g['ask'].to_numpy()
        isF = (g['kind'] == 'F').to_numpy()
        idx = np.where(isF)[0]
        if not len(idx): continue
        n = len(g)
        # future matrix: rows = candidate entries, cols = all later obs
        later = np.arange(n)[None, :] > idx[:, None]
        mult = np.where(later, bids[None, :] / asks[idx][:, None], np.nan)
        maxm = np.nanmax(np.where(later, mult, -np.inf), axis=1)
        maxm[~np.isfinite(maxm)] = np.nan
        rec = {'row': g.index.to_numpy()[idx], 'max_mult': maxm,
               'n_later': later.sum(1), 'last_mod_seen': np.full(len(idx), mods[-1])}
        for k in K:
            ge = later & (mult >= k)
            anyh = ge.any(1)
            first = np.where(anyh, ge.argmax(1), -1)
            fm = np.where(anyh, mods[np.clip(first, 0, n - 1)], -1)
            nxt = np.clip(first + 1, 0, n - 1)
            conf = anyh & (first + 1 < n) & (bids[nxt] >= k * asks[idx])
            rec[f'hit{k}'] = anyh; rec[f'hit{k}_mod'] = fm; rec[f'conf{k}'] = conf
            if k == 1.5:
                # adverse excursion before the first hit (or over the rest of the day when it never hit)
                before = later & (np.arange(n)[None, :] < np.where(anyh, first, n)[:, None])
                mae = np.nanmin(np.where(before, mult, np.inf), axis=1)
                mae[~np.isfinite(mae)] = np.nan
                rec['mae_before_15'] = mae
                # how many consecutive snapshots the bid held >= 1.5x after the first hit
                held = np.zeros(len(idx), dtype=int)
                for j in np.where(anyh)[0]:
                    t = first[j]
                    while t < n and bids[t] >= k * asks[idx[j]]: held[j] += 1; t += 1
                rec['held_snaps_15'] = held
        out.append(pd.DataFrame(rec))
    lab = pd.concat(out, ignore_index=True).set_index('row')
    return df.loc[lab.index].join(lab)

def load_ctx():
    parts = []
    for p in sorted(glob.glob(f'{OUT}/ctx-*.csv.gz')):
        try:
            parts.append(pd.read_csv(p, dtype={'minute': str}))
        except Exception:
            pass
    c = pd.concat(parts, ignore_index=True)
    c['mod'] = c['minute'].map(mod)
    return c.drop(columns=['minute'])

ENGINE_ROWS = f'/home/user/falcon-cloud-field-sail/slayer/.cache/compass/rows/{DAY}.jsonl'

def engine_scores():
    """the live Compass engine's own score (p1) of each contract it scored at a 5-minute mark (its rows log)"""
    out = []
    if not os.path.exists(ENGINE_ROWS): return pd.DataFrame()
    for l in open(ENGINE_ROWS):
        try:
            r = json.loads(l)
            root, rest = r['k'].split()
            out.append({'sym': root, 'exp': r['e'].replace('-', ''), 'strike_f': float(rest[:-1]), 'right': rest[-1],
                        'mod': int(r['t']) - 570, 'engine_p1': r.get('p1'), 'engine_bid': r.get('b'), 'engine_ask': r.get('a')})
        except Exception:
            pass
    e = pd.DataFrame(out)
    return e.drop_duplicates(['sym', 'exp', 'strike_f', 'right', 'mod'], keep='last') if len(e) else e

def add_features(x):
    s = np.where(x['right'] == 'C', 1.0, -1.0)
    x['abs_delta'] = x['delta'].abs()
    x['spread_pct'] = (x['ask'] - x['bid']) / ((x['ask'] + x['bid']) / 2) * 100
    x['strike_f'] = x['strike'].astype(float)
    x['otm_pct'] = s * (x['strike_f'] / x['under'] - 1) * 100
    x['min_to_close'] = 390 - x['mod']
    x['dte0'] = (x['exp'] == DAY.replace('-', '')).astype(int)
    x['tierA'] = x['sym'].isin(TIER_A).astype(int)
    x['iv_minus_atm'] = x['iv'] - x['atm_iv']
    x['is_call'] = (x['right'] == 'C').astype(int)
    x['ask_x_size'] = x['ask_size']
    for f in ['ret1', 'ret5', 'ret15', 'vwap_dev_pct', 'from_open_pct', 'spy_ret15', 'vix_chg15_pct']:
        if f in x: x['dir_' + f] = s * x[f]
    if 'range_pos' in x: x['dir_range_pos'] = np.where(s > 0, x['range_pos'], 1 - x['range_pos'])
    for w in (1, 5, 15):
        c = f'flow{w}_call_share'
        if c in x: x[f'dir_flow{w}_side_share'] = np.where(s > 0, x[c], 1 - x[c])
    for cut in ('all', 'front'):
        a, b = f'{cut}_poswall_above_pct', f'{cut}_negwall_below_pct'
        if a in x and b in x:
            x[f'dir_{cut}_wall_ahead_pct'] = np.where(s > 0, x[a], -x[b])  # distance to the wall in the option's way
            x[f'dir_{cut}_wall_behind_pct'] = np.where(s > 0, -x[b], x[a])
        f = f'{cut}_flip_proxy_pct'
        if f in x: x[f'dir_{cut}_flip_pct'] = s * x[f]
    return x

def auc(pos, neg):
    pos = pos[np.isfinite(pos)]; neg = neg[np.isfinite(neg)]
    if len(pos) < 5 or len(neg) < 5: return np.nan
    allv = np.concatenate([pos, neg]); r = pd.Series(allv).rank().to_numpy()
    return (r[:len(pos)].sum() - len(pos) * (len(pos) + 1) / 2) / (len(pos) * len(neg))

def compare(x, lab='hit1.5', feats=None):
    rows = []
    for f in feats:
        v = pd.to_numeric(x[f], errors='coerce')
        if v.notna().sum() < 50: continue
        p = v[x[lab]].to_numpy(dtype=float); n = v[~x[lab]].to_numpy(dtype=float)
        pm, nm = np.nanmean(p), np.nanmean(n)
        sd = np.nanstd(v.to_numpy(dtype=float))
        # stratified AUC: within each underlying, weighted by its candidate rows (removes "which name" confounding)
        sa, sw = 0.0, 0.0
        for sym, g in x.groupby('sym'):
            gv = pd.to_numeric(g[f], errors='coerce').to_numpy(dtype=float)
            a = auc(gv[g[lab].to_numpy()], gv[~g[lab].to_numpy()])
            if np.isfinite(a): sa += a * len(g); sw += len(g)
        rows.append({'feature': f, 'n_obs': int(v.notna().sum()), 'mover_mean': pm, 'all_mean': np.nanmean(v),
                     'nonmover_mean': nm, 'mover_median': np.nanmedian(p), 'all_median': np.nanmedian(v),
                     'cohen_d': (pm - nm) / sd if sd > 0 else np.nan, 'auc': auc(p, n),
                     'auc_within_name': sa / sw if sw else np.nan})
    r = pd.DataFrame(rows)
    r['strength'] = (r['auc_within_name'] - 0.5).abs()
    return r.sort_values('strength', ascending=False)

def move_type(ev, ctx_idx, news_by):
    """descriptive (uses the path entry->exit; for counting only, never a rule)"""
    sym = ev['sym']; e, x = mod(ev['entry_minute']), mod(ev['exit_minute'])
    s = 1 if ev['right'] == 'C' else -1
    for m in range(max(0, e - 15), x + 1):
        if news_by.get((sym, m), 0) > 0: return 'news'
    spy_shock = any(ctx_idx.get(('SPY', m), {}).get('spy_shock15') == 1 for m in range(e, x + 1))
    if spy_shock: return 'vol_shock'
    c = ctx_idx.get((sym, e), {})
    r15 = c.get('ret15')
    if r15 is None or (isinstance(r15, float) and math.isnan(r15)): r15 = c.get('ret5')
    if r15 is None or (isinstance(r15, float) and math.isnan(r15)): return 'unknown (first minutes)'
    return 'trend_continuation' if s * r15 > 0 else 'reversal'

def bucket_delta(d):
    return pd.cut(d, [0.099, 0.2, 0.3, 0.45, 0.601], labels=['0.10-0.20', '0.20-0.30', '0.30-0.45', '0.45-0.60'])

def bucket_tod(m):
    return pd.cut(m, [-1, 29, 89, 209, 299, 359, 391], labels=['09:30-10:00', '10:00-11:00', '11:00-13:00', '13:00-14:30', '14:30-15:30', '15:30-16:00'])

def md_table(df, floatfmt=3):
    cols = list(df.columns)
    out = ['| ' + ' | '.join(str(c) for c in cols) + ' |', '|' + '---|' * len(cols)]
    for _, r in df.iterrows():
        cells = []
        for c in cols:
            v = r[c]
            if isinstance(v, (float, np.floating)):
                cells.append('' if not np.isfinite(v) else (f'{v:.{floatfmt}f}' if abs(v) < 1e5 else f'{v:.3g}'))
            else:
                cells.append(str(v))
        out.append('| ' + ' | '.join(cells) + ' |')
    return '\n'.join(out)

def main():
    ch = load_chain()
    lab = label(ch)
    ctx = load_ctx()
    x = lab.merge(ctx, on=['sym', 'mod'], how='left', suffixes=('', '_ctx'))
    x = add_features(x)
    for k in K:
        x[f'hit{k}'] = x[f'hit{k}'].astype(bool)
    eng = engine_scores()
    if len(eng):
        x = x.merge(eng, on=['sym', 'exp', 'strike_f', 'right', 'mod'], how='left')
    x = x.copy()
    x['tod'] = bucket_tod(x['mod']); x['dbucket'] = bucket_delta(x['abs_delta'])
    x.to_parquet(f'{OUT}/labels.parquet', compression='zstd')
    ev = [json.loads(l) for l in open(f'{OUT}/movers.jsonl')] if os.path.exists(f'{OUT}/movers.jsonl') else []
    evd = pd.DataFrame(ev)
    # news by (sym, minute) from the context (news15 counts the last 15 min; a jump = a new headline)
    ctx_idx = {(r['sym'], r['mod']): r for r in ctx.to_dict('records')}
    news_by = {}
    for (sym, m), r in ctx_idx.items():
        prev = ctx_idx.get((sym, m - 1), {}).get('news15', 0) or 0
        if (r.get('news15') or 0) > prev: news_by[(sym, m)] = 1
    if len(evd):
        evd['move_type'] = [move_type(e, ctx_idx, news_by) for e in ev]
        evd['dbucket'] = bucket_delta(evd['entry_delta'].abs()); evd['tod'] = bucket_tod(evd['entry_minute'].map(mod))
        evd['minutes_held'] = evd['exit_minute'].map(mod) - evd['entry_minute'].map(mod)
    feats = [c for c in x.columns if c not in ('minute', 'kind', 'sym', 'exp', 'strike', 'right', 'g_ts', 'q_ts', 'under_ts',
             'key', 'tod', 'dbucket', 'max_mult', 'n_later', 'last_mod_seen', 'engine_ok', 'strike_f', 'chain_refreshed',
             'price', 'under', 'mod', 'mae_before_15', 'held_snaps_15', 'news15_all', 'theta', 'vega', 'ask_x_size',
             'engine_bid', 'engine_ask')
             and not c.startswith('hit') and not c.startswith('conf') and x[c].dtype.kind in 'fiub']
    L = []
    n_all = len(x); n_names = x['sym'].nunique()
    L.append(f'# LIVE-SCAN day report, {DAY}\n')
    L.append('**One day proves nothing.** Everything below describes a single session (with a sharp opening drop). '
             'Contract-minutes are heavily dependent (one index move lifts dozens of strikes at once and the same contract '
             'is counted every minute), so effective sample sizes are far smaller than the row counts. Nothing here is '
             'validated; the rules at the end are hypotheses to pre-register and test on history and on forward days.\n')
    L.append('## What was recorded\n')
    cov = [json.loads(l) for l in open(f'{OUT}/coverage.jsonl')]
    seen = {}
    for c in cov:
        for s in c.get('refreshed', []): seen.setdefault(s, []).append(mod(c['minute']))
    gaps = [(max(v) - min(v)) / (len(v) - 1) for v in seen.values() if len(v) > 1]
    tb = [g for s, v in seen.items() if s not in TIER_A and len(v) > 1 for g in [(max(v) - min(v)) / (len(v) - 1)]]
    L.append(f'- {len(cov)} minute cycles; {len(ch)} contract snapshots stored, {n_all} buyable contract-minutes '
             f'({x["key"].nunique()} contracts, {n_names} underlyings with at least one candidate).\n'
             f'- Tier A (SPY QQQ IWM SPXW 0DTE + 8 megacaps nearest expiry) every minute; tier B (the other names of the '
             f'458 universe, nearest expiry) on a rolling budget: median refresh interval '
             f'{np.median(tb) if tb else float("nan"):.1f} min across {len(tb)} tier-B names (names with no candidate '
             f'contract were visited every 3rd pass). Labels for tier-B contracts are therefore coarser (a 1.5x touch '
             f'between visits is missed): compare within tier.\n'
             f'- Terminal health at the close: {cov[-1]["health"]}. Cycle seconds: median {np.median([c["secs"] for c in cov]):.0f}, '
             f'max {max(c["secs"] for c in cov):.0f}.\n')
    L.append('## Base rate (the honest denominator)\n')
    br = []
    for name, g in [('all', x), ('tier A', x[x.tierA == 1]), ('tier B', x[x.tierA == 0]),
                    ('protocol cut |d| 0.15-0.50, spread <= 8%', x[(x.abs_delta >= 0.15) & (x.abs_delta <= 0.5) & (x.spread_pct <= 8)]),
                    ('0DTE', x[x.dte0 == 1]), ('next-expiry', x[x.dte0 == 0]), ('calls', x[x.is_call == 1]), ('puts', x[x.is_call == 0])]:
        if not len(g): continue
        br.append({'set': name, 'contract_minutes': len(g), 'reached_1.5x': g['hit1.5'].mean(), 'confirmed_1.5x': g['conf1.5'].mean(),
                   'reached_2x': g['hit2.0'].mean(), 'reached_5x': g['hit5.0'].mean(),
                   'median_max_mult': g['max_mult'].median()})
    L.append(md_table(pd.DataFrame(br)) + '\n')
    L.append('\nReached = a later snapshot bid >= k x the entry ask (round trip, ask in / bid out, no fees, no latency). '
             'Confirmed = the next snapshot also held it. These are UPPER bounds on what a trader could capture: '
             'nobody sells every contract at its best later bid.\n')
    for dim, title in [('sym', 'underlying'), ('dbucket', 'delta bucket'), ('tod', 'time of day (entry)')]:
        g = x.groupby(dim, observed=True).agg(contract_minutes=('hit1.5', 'size'), reached_15=('hit1.5', 'mean'),
                                              reached_2=('hit2.0', 'mean'), reached_5=('hit5.0', 'mean')).reset_index()
        if dim == 'sym':
            g = g.sort_values('contract_minutes', ascending=False)
            g = pd.concat([g[g.sym.isin(TIER_A)], g[~g.sym.isin(TIER_A)].head(15)])
        L.append(f'\n### Base rate by {title}\n')
        L.append(md_table(g) + '\n')
    L.append('\n## Mover events (live log, first time a contract reached k x its running-minimum candidate ask)\n')
    if len(evd):
        cnt = evd.groupby('threshold')['contract'].nunique().rename('contracts').reset_index()
        L.append(md_table(cnt, 1) + '\n')
        e15 = evd[evd.threshold == 1.5]
        for dim, title in [('sym', 'underlying'), ('dbucket', 'entry delta bucket'), ('tod', 'entry time of day'), ('move_type', 'move type')]:
            t = evd.groupby([dim, 'threshold'], observed=True)['contract'].nunique().unstack(fill_value=0).reset_index()
            if dim == 'sym': t = t.sort_values(1.5, ascending=False).head(25)
            t.columns = [str(c) for c in t.columns]
            L.append(f'\n### Movers by {title}\n')
            L.append(md_table(t, 0) + '\n')
        L.append(f'\nMove type is descriptive (it looks at the path from entry to exit): news = a headline on the name '
                 f'from 15 min before entry to exit; vol_shock = SPY 15-min |return| > 2.5 sd of its ATM IV inside the '
                 f'hold; otherwise trend_continuation if the 15-min return before entry already pointed the option\'s '
                 f'way, else reversal. Median minutes from entry to the 1.5x touch: {e15["minutes_held"].median():.0f}.\n')
        # episodes: distinct (underlying, side, 15-min entry window)
        e15 = e15.assign(win=e15['entry_minute'].map(mod) // 15)
        ep = e15.groupby(['sym', 'right', 'win']).size()
        L.append(f'\nIndependent-ish episodes behind the 1.5x movers (underlying x side x 15-min entry window): '
                 f'{len(ep)} (vs {e15["contract"].nunique()} contracts).\n')
    L.append('\n## Could it be grabbed? (rows that reached 1.5x)\n')
    h = x[x['hit1.5']]
    if len(h):
        tt = (h['hit1.5_mod'] - h['mod'])
        L.append(f'- minutes from entry to first 1.5x bid: median {tt.median():.0f}, p25 {tt.quantile(.25):.0f}, p75 {tt.quantile(.75):.0f}\n'
                 f'- worst bid before the hit, as a multiple of the entry ask (adverse excursion): median {h["mae_before_15"].median():.2f}, '
                 f'p10 {h["mae_before_15"].quantile(.1):.2f} (non-movers over the rest of the day: median {x.loc[~x["hit1.5"], "mae_before_15"].median():.2f})\n'
                 f'- snapshots the bid stayed >= 1.5x after the first touch: median {h["held_snaps_15"].median():.0f}; share held only one snapshot: {(h["held_snaps_15"] == 1).mean():.2f}\n'
                 f'- entry spread % of mid: movers median {h["spread_pct"].median():.1f} vs all {x["spread_pct"].median():.1f}; tier-A displayed ask size at entry: movers median {h["ask_size"].median():.0f} vs all {x["ask_size"].median():.0f}\n'
                 f'- entry ask: movers median {h["ask"].median():.2f} vs all {x["ask"].median():.2f}\n')
    L.append('\n## Movers vs ALL buyable contract-minutes: context at entry\n')
    L.append('Label = the contract-minute later reached 1.5x (hit1.5). `auc` = probability a random mover row has a higher '
             'value than a random non-mover row (0.5 = no difference); `auc_within_name` computes it inside each '
             'underlying and averages (weights = rows), which removes the "which name was moving today" confound. '
             'cohen_d = mean difference / pooled sd. Sorted by |auc_within_name - 0.5|.\n')
    for name, g in [('all buyable contract-minutes', x), ('tier A only (minute-sampled)', x[x.tierA == 1])]:
        cmp = compare(g, 'hit1.5', feats)
        L.append(f'\n### {name}: {len(g)} rows, {int(g["hit1.5"].sum())} reached 1.5x\n')
        L.append(md_table(cmp.drop(columns=['strength']).head(40)) + '\n')
        cmp.to_csv(f'{OUT}/compare-{"all" if "all" in name else "tierA"}.csv', index=False)
    if 'engine_p1' in x and x['engine_p1'].notna().sum() > 50:
        g = x[x['engine_p1'].notna()]
        L.append(f'\n### The Compass engine\'s own score at its 5-minute marks (rows it scored: {len(g)}, reached 1.5x: {int(g["hit1.5"].sum())})\n')
        q = pd.qcut(g['engine_p1'].rank(method='first'), 5, labels=['q1 (low)', 'q2', 'q3', 'q4', 'q5 (high)'])
        t = g.groupby(q, observed=True).agg(rows=('hit1.5', 'size'), p1_mean=('engine_p1', 'mean'), reached_15=('hit1.5', 'mean'),
                                            reached_2=('hit2.0', 'mean'), median_max_mult=('max_mult', 'median')).reset_index()
        L.append(md_table(t) + f'\n\nAUC of engine p1 for reaching 1.5x: {auc(g.loc[g["hit1.5"], "engine_p1"].to_numpy(float), g.loc[~g["hit1.5"], "engine_p1"].to_numpy(float)):.3f} '
                 '(the engine is built for a different target; this only says whether its score also ranks today\'s movers).\n')
    # held out within the day? no: report a simple time split as a stability check (not validation)
    early, late = x[x['mod'] < 195], x[x['mod'] >= 195]
    if len(early) > 100 and len(late) > 100:
        ce = compare(early, 'hit1.5', feats).set_index('feature'); cl = compare(late, 'hit1.5', feats).set_index('feature')
        j = ce[['auc_within_name']].join(cl[['auc_within_name']], lsuffix='_am', rsuffix='_pm').dropna()
        j['same_side'] = np.sign(j['auc_within_name_am'] - 0.5) == np.sign(j['auc_within_name_pm'] - 0.5)
        j['strength'] = (j[['auc_within_name_am', 'auc_within_name_pm']] - 0.5).abs().min(axis=1)
        j = j.sort_values('strength', ascending=False).head(20).drop(columns=['strength']).reset_index()
        L.append('\n### Stability check: morning (09:30-12:45) vs afternoon entries (same day, NOT validation)\n')
        L.append(md_table(j) + '\n')
    open(REPORT, 'w').write('\n'.join(L))
    summ = {'day': DAY, 'contract_minutes': n_all, 'base_rate_1.5': float(x['hit1.5'].mean()),
            'base_rate_2': float(x['hit2.0'].mean()), 'base_rate_5': float(x['hit5.0'].mean()),
            'movers_contracts': {str(k): int(evd[evd.threshold == k]['contract'].nunique()) for k in K} if len(evd) else {}}
    json.dump(summ, open(os.path.join(HERE, f'summary-{DAY}.json'), 'w'), indent=1)
    print(json.dumps(summ))

if __name__ == '__main__':
    main()
