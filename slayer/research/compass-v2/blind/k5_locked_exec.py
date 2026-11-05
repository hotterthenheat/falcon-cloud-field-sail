"""BLIND SCORER — the same 59 K5 locked-test calls re-settled under V2_PROTOCOL item 2 execution, with the FOUNDATION
simulator (sim/engine.py on an in-memory session of 1-second NBBO fetched for each called contract only).

Signal and contract: exactly the calls k5_locked.py produced (results/K5-LOCKED.json): the spec's rule on the
challenger's rows; nothing re-selected. Execution: decision at the mark; the buy arrives 2 s later and fills at the
ask then in force, 1 contract, capped to the displayed ask size; the exit is the spec's hard bracket evaluated at every
quote change — bid >= 1.50 x fill (take profit) or bid <= 0.4678 x fill (stop) — and the 09:20 flat; each exit order
arrives 2 s later and sells at the bid then in force. Fees $0.65/contract/side (ret_net), and gross.
Quotes: ThetaData v3 /option/history/quote interval=1s, 00:00-09:30 ET of the session day (one request at a time,
cached as parquet of state changes under /home/user/falcon-cloud-field-sail/v2data/blind/quotes1s/).

    BLIND_SCORER=1 python3 k5_locked_exec.py
"""
import io, json, os, sys, time, urllib.request, urllib.parse
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import chal_c45a7d2 as chal   # rows (expiry lookup only)

FOUNDATION = '/home/user/falcon-cloud-field-sail/.claude/worktrees/agent-a82a31a7b4c525883/slayer/research/compass-v2'
sys.path.insert(0, FOUNDATION)
from data.store import Contract                      # noqa: E402
from sim.engine import Engine, SimConfig, Strategy, clock  # noqa: E402
from sim.exits import FixedBracket                   # noqa: E402
from sim.memsession import MemSession                # noqa: E402
from eval.metrics import basic, cluster_ci_mean, max_drawdown  # noqa: E402

THETA = 'http://127.0.0.1:25503/v3'
QDIR = '/home/user/falcon-cloud-field-sail/v2data/blind/quotes1s'
OUT = os.path.join(HERE, 'results')
_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))   # the terminal is local: no proxy


def fetch_1s(day, exp, strike, right):
    os.makedirs(QDIR, exist_ok=True)
    f = os.path.join(QDIR, f'{day}_{exp}_{strike:g}{"C" if right == 1 else "P"}.parquet')
    if os.path.exists(f):
        return pd.read_parquet(f)
    q = {'symbol': 'SPXW', 'expiration': exp, 'strike': f'{strike:g}', 'right': 'call' if right == 1 else 'put',
         'date': day.replace('-', ''), 'interval': '1s', 'start_time': '00:00:00.000', 'end_time': '09:30:00.000', 'format': 'csv'}
    url = f'{THETA}/option/history/quote?{urllib.parse.urlencode(q)}'
    for attempt in range(4):
        try:
            with _opener.open(url, timeout=600) as r:
                body = r.read()
            break
        except Exception as e:  # noqa: BLE001
            if attempt == 3:
                raise
            time.sleep(3 * (attempt + 1))
    df = pd.read_csv(io.BytesIO(body))
    t = pd.to_datetime(df['timestamp'])
    ms = ((t - t.dt.normalize()).dt.total_seconds() * 1000).round().astype('int64')
    out = pd.DataFrame({'ms': ms, 'bid': np.round(df['bid'].to_numpy(float) * 100).astype('int32'),
                        'ask': np.round(df['ask'].to_numpy(float) * 100).astype('int32'),
                        'bs': df['bid_size'].astype('int32'), 'as': df['ask_size'].astype('int32')})
    ch = np.r_[True, (out[['bid', 'ask', 'bs', 'as']].to_numpy()[1:] != out[['bid', 'ask', 'bs', 'as']].to_numpy()[:-1]).any(1)]
    out = out[ch].reset_index(drop=True)
    out.to_parquet(f, compression='zstd')
    time.sleep(0.2)
    return out


class OneCall(Strategy):
    timer_ms = None

    def __init__(self, c, mark_ms):
        self.c, self.wake_ms = c, (mark_ms,)

    def on_event(self, ctx, ev):
        if ev.kind == 'wake' and ev.ms == self.wake_ms[0] and not ctx.pending_or_open:
            ctx.buy(self.c, qty=1, exit=FixedBracket(tp=1.5, sl=0.4678), tag='K5')


def expiry_of(day, contract, mark):
    x = chal.C.load_day(day, cache=False)
    x = x[(x['ticker'].astype(str) == 'SPXW') & (x['session'].astype(str) == 'overnight')
          & (x['contract'].astype(str) == contract) & (x['mark'].astype(str) == mark)]
    assert len(x) >= 1, (day, contract, mark)
    r = x.iloc[0]
    return str(r['expiry']), float(r['strike']), 1 if str(r['right']) == 'C' else -1, float(r['bid']), float(r['ask'])


def regime(d):
    return '2022' if d < '2023' else '2024' if d < '2025' else '2025-Q1' if d < '2026' else '2026-H2'


def summarize(t, days, label):
    out = {'label': label, 'sessions': len(days), 'n': int(len(t))}
    if not len(t):
        return out
    t = t.sort_values(['session', 'entry_ms']).reset_index(drop=True)
    ses = t['session'].astype(str).to_numpy()
    tp = (t['reason'] == 'tp').to_numpy()
    for key, name, pnl in (('ret_gross', 'no_fee', 'pnl_gross'), ('ret_net', 'fee', 'pnl_net')):
        r = t[key].to_numpy(float)
        b = basic(r)
        lo, hi = cluster_ci_mean(r, ses, 4000, seed=7, extra_clusters=days)
        wlo, whi = cluster_ci_mean(tp.astype(float), ses, 4000, seed=7, extra_clusters=days)
        plo, phi = cluster_ci_mean((r > 0).astype(float), ses, 4000, seed=7, extra_clusters=days)
        out[name] = {'expectancy': b['expectancy'], 'ci_expectancy': [lo, hi],
                     'win_rate_tp': float(tp.mean()), 'ci_win_rate_tp': [wlo, whi],
                     'win_rate_ret_gt0': b['win_rate'], 'ci_win_rate_ret_gt0': [plo, phi],
                     'avg_win': b['avg_win'], 'avg_loss': b['avg_loss'], 'payoff': b['payoff'], 'median': b['median'],
                     'max_dd_ret_units': max_drawdown(r), 'usd_per_contract': float(t[pnl].mean()),
                     'max_dd_usd_per_contract': max_drawdown(t[pnl].to_numpy(float))}
    out['reasons'] = {k: int(v) for k, v in t['reason'].value_counts().items()}
    out['forced'] = int(t['forced'].sum())
    return out


def fmt(s):
    if not s.get('n'):
        return f"{s['label']}: {s['sessions']} sessions, 0 trades"
    a, f = s['no_fee'], s['fee']
    return (f"{s['label']}: {s['sessions']} sessions, n={s['n']} exits {s['reasons']} forced {s['forced']}\n"
            f"  win rate (TP) {100*a['win_rate_tp']:.1f}% [{100*a['ci_win_rate_tp'][0]:.1f}, {100*a['ci_win_rate_tp'][1]:.1f}];"
            f" ret>0: gross {100*a['win_rate_ret_gt0']:.1f}% [{100*a['ci_win_rate_ret_gt0'][0]:.1f}, {100*a['ci_win_rate_ret_gt0'][1]:.1f}]"
            f" net {100*f['win_rate_ret_gt0']:.1f}% [{100*f['ci_win_rate_ret_gt0'][0]:.1f}, {100*f['ci_win_rate_ret_gt0'][1]:.1f}]\n"
            f"  expectancy/trade gross {100*a['expectancy']:+.1f}% [{100*a['ci_expectancy'][0]:+.1f}, {100*a['ci_expectancy'][1]:+.1f}]"
            f"  | net of fee {100*f['expectancy']:+.1f}% [{100*f['ci_expectancy'][0]:+.1f}, {100*f['ci_expectancy'][1]:+.1f}]\n"
            f"  avg win {100*a['avg_win']:+.1f}%, avg loss {100*a['avg_loss']:+.1f}%, payoff {a['payoff']:.2f} (net {f['payoff']:.2f})\n"
            f"  $/contract gross {a['usd_per_contract']:+.0f} (net {f['usd_per_contract']:+.0f});"
            f" max DD (cum. return units) {100*a['max_dd_ret_units']:+.0f}% (net {100*f['max_dd_ret_units']:+.0f}%),"
            f" max DD $/contract {a['max_dd_usd_per_contract']:+.0f} (net {f['max_dd_usd_per_contract']:+.0f})")


def main():
    if os.environ.get('BLIND_SCORER') != '1':
        sys.exit('locked look reserved for the blind scorer (BLIND_SCORER=1)')
    res = os.path.join(OUT, 'K5-LOCKED-exec.json')
    if os.path.exists(res):
        sys.exit(f'already run ({res}); not looking again')
    L = json.load(open(os.path.join(OUT, 'K5-LOCKED.json')))
    days = L['days']
    cfg = SimConfig(latency_ms=2000, fee_per_contract=0.65, fill_rule='in_force', cap_to_displayed=True,
                    start_ms=clock('00:00'), flat_ms=clock('09:20'), end_ms=clock('09:30'))
    trades, rejects, calls = [], [], []
    t0 = time.time()
    for k, c in enumerate(L['calls']):
        exp, strike, right, mbid, mask = expiry_of(c['day'], c['contract'], c['mark'])
        q = fetch_1s(c['day'], exp.replace('-', ''), strike, right)
        con = Contract('SPXW', int(exp.replace('-', '')), int(round(strike * 1000)), right)
        ses = MemSession(c['day'].replace('-', ''), {con: {k2: q[k2].to_numpy() for k2 in ('ms', 'bid', 'ask', 'bs', 'as')}})
        mark_ms = clock(c['mark'])
        eng = Engine(ses, OneCall(con, mark_ms), cfg)
        log = eng.run()
        info = {'day': c['day'], 'contract': str(con), 'mark': c['mark'], 'row_fill_minute_ask': c['fill'], 'row_bid_at_mark': mbid,
                'row_ask_at_mark': mask, 'row_ret': c['ret'], 'row_win': c['win'], 'quote_changes': int(len(q))}
        if log:
            tr = dict(log[0]); tr.pop('meta', None)
            trades.append(tr)
            info.update(fill=tr['entry_px'], entry_ms=tr['entry_ms'], entry_ask_size=tr['entry_ask_size'], exit_px=tr['exit_px'],
                        reason=tr['reason'], ret_gross=tr['ret_gross'], ret_net=tr['ret_net'], forced=tr['forced'])
        else:
            rejects += eng.rejects
            info.update(rejected=[r['why'] for r in eng.rejects])
        calls.append(info)
        print(f'[{k+1}/{len(L["calls"])}] {c["day"]} {con} {c["mark"]} -> {info.get("reason", info.get("rejected"))} '
              f'fill {info.get("fill")} (row {c["fill"]}) ret_gross {info.get("ret_gross")}', flush=True)
    tr = pd.DataFrame(trades)
    parts = [summarize(tr, days, 'K5 LOCKED TEST, protocol-2 execution (foundation sim, 1-s NBBO)')]
    for key in sorted({regime(d) for d in days}):
        dd = [d for d in days if regime(d) == key]
        parts.append(summarize(tr[tr['session'].map(lambda s: regime(f'{s[:4]}-{s[4:6]}-{s[6:]}')) == key] if len(tr) else tr, dd, f'regime {key}'))
    txt = '\n'.join(fmt(p) for p in parts)
    print(txt)
    print(f'rejected entries: {len(rejects)}; terminal requests ~{len(L["calls"])}, {time.time()-t0:.0f} s; quote cache '
          f'{sum(os.path.getsize(os.path.join(QDIR, f)) for f in os.listdir(QDIR))/1e6:.1f} MB')
    json.dump({'spec_commit': L['spec_commit'], 'spec_sha256': L['spec_sha256'], 'config': cfg.__dict__, 'days': days, 'calls': calls,
               'rejects': rejects, 'summary': parts, 'text': txt}, open(res, 'w'), indent=1, default=float)


if __name__ == '__main__':
    main()
