#!/usr/bin/env python3
"""LIVE-SCAN forward builder: runs beside scan_collect.py and, minute by minute, as each chain-HHMM file lands:

  1. writes ctx-HHMM.csv.gz: one CONTEXT row per underlying in the universe, from data stamped at or before the
     minute's decision time T = HH:MM:01 ET (never revisited later, so the record holds no hindsight):
       price, session VWAP (from cumulative-volume deltas of the 1-min snapshots), % from open, position in day range,
       1/5/15-min returns, realized vol so far vs ATM IV (from our own chain snapshot), the Terrain book from the
       app's exposure recorder (net GEX settled/live for every-expiry and front cuts, flip proxy, walls proxies,
       supreme strike, live vs settled top strike), the Compass engine's open calls (/api/compass/state),
       UW flow alerts in the last 1/5/15 min and headlines in the last 15 min (from the recorder files, by the
       time WE received them), SPY 15-min vol shock flag, VIX and its 15-min change, minute of day.
  2. appends MOVER events to movers.jsonl the moment a contract's bid reaches 1.5x / 2x / 5x an EARLIER candidate ask
     (running minimum ask since 09:30 over minutes the contract was a candidate).
Exit: after the 16:00 file is processed.
"""
import csv, gzip, io, json, math, os, sys, time, datetime as dt, glob, urllib.request
from collections import defaultdict, deque
from zoneinfo import ZoneInfo

ET = ZoneInfo('America/New_York')
DAY = sys.argv[1] if len(sys.argv) > 1 else dt.datetime.now(ET).strftime('%Y-%m-%d')
OUT = f'/home/user/falcon-cloud-field-sail/v2data/live/scan/{DAY}'
LIVE = '/home/user/falcon-cloud-field-sail/v2data/live'
EXPO = f'/home/user/falcon-cloud-field-sail/slayer/.cache/exposure/{DAY}'
HERE = os.path.dirname(os.path.abspath(__file__))
UNIV = json.load(open(os.path.join(HERE, '../../../public/config/universe_458.json')))
PRICE_OF = {'SPXW': 'SPX', 'SPX': 'SPX', 'XSP': 'SPX', 'NDXP': 'NDX', 'NDX': 'NDX', 'VIX': 'VIX'}
SCALE = {'XSP': 0.1}
BOOK_OF = {'SPXW': 'SPX', 'SPX': 'SPX', 'XSP': 'SPX'}
THRESH = [1.5, 2.0, 5.0]
LOG = open(f'{OUT}/build.log', 'a', buffering=1)

def log(*a):
    LOG.write(dt.datetime.now(ET).strftime('%H:%M:%S ') + ' '.join(str(x) for x in a) + '\n')

def f(x):
    try:
        v = float(x)
        return v if math.isfinite(v) else None
    except Exception:
        return None

def tms(minute):  # decision time of a minute tag, epoch ms
    d = dt.datetime.strptime(DAY + ' ' + minute, '%Y-%m-%d %H%M').replace(tzinfo=ET)
    return int(d.timestamp() * 1000) + 1000

def iso_ms(s):
    try:
        return int(dt.datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp() * 1000)
    except Exception:
        return None

# ---------------- streams read incrementally ----------------
class GzTail:
    """Reads new complete JSON lines of a growing (multi-member) .jsonl.gz by re-decompressing (files are small)."""
    def __init__(self, path):
        self.path, self.seen = path, 0
    def new(self):
        try:
            with gzip.open(self.path, 'rt') as fh:
                lines = fh.read().split('\n')
        except Exception:
            try:  # a member still being written: read what decompresses
                import zlib
                raw = open(self.path, 'rb').read()
                d = zlib.decompressobj(16 + zlib.MAX_WBITS); txt = ''
                while raw:
                    txt += d.decompress(raw).decode('utf8', 'ignore'); raw = d.unused_data
                    if raw: d = zlib.decompressobj(16 + zlib.MAX_WBITS)
                lines = txt.split('\n')
            except Exception:
                return []
        lines = [l for l in lines if l.strip()]
        if len(lines) and not lines[-1].rstrip().endswith('}'): lines = lines[:-1]
        out = []
        for l in lines[self.seen:]:
            try: out.append(json.loads(l))
            except Exception: pass
        self.seen = len(lines)
        return out

flow_tail = GzTail(f'{LIVE}/flow-{DAY}.jsonl.gz')
news_tail = GzTail(f'{LIVE}/news-{DAY}.jsonl.gz')
flows = []   # (recv_ms, ticker, premium, is_call, ask_prem)
news = []    # (recv_ms, tickers, major)
flow_ids = set()

def pull_streams():
    for r in flow_tail.new():
        rid = r.get('id')
        if rid in flow_ids: continue
        flow_ids.add(rid)
        t = iso_ms(r.get('_received_at', '')) or 0
        prem = f(r.get('total_premium')) or 0.0
        flows.append((t, r.get('ticker'), prem, r.get('type') == 'call', f(r.get('total_ask_side_prem')) or 0.0,
                      bool(r.get('has_sweep'))))
    for r in news_tail.new():
        t = iso_ms(r.get('_received_at', '')) or 0
        news.append((t, set(r.get('tickers') or []), bool(r.get('is_major'))))

# ---------------- exposure recorder (Terrain book) ----------------
expo_cache = {}  # ticker -> (size, lines)

def expo_lines(tk):
    p = f'{EXPO}/{tk}.jsonl'
    try:
        sz = os.path.getsize(p)
    except Exception:
        return []
    c = expo_cache.get(tk)
    if c and c[0] == sz: return c[1]
    lines = []
    for l in open(p):
        try: lines.append(json.loads(l))
        except Exception: pass
    expo_cache[tk] = (sz, lines)
    return lines

def book_features(tk, spot, T):
    out = {}
    lines = [l for l in expo_lines(tk) if l.get('n', 0) <= T]
    if not lines or not spot: return out
    for cutname in ('ALL', 'FRONT'):
        sel = [l for l in lines if (l['c'] == 'ALL') == (cutname == 'ALL')]
        if not sel: continue
        lastat = max(l['at'] for l in sel)
        rows = {}
        for l in sel:
            if l['at'] == lastat:
                for strike, back, oi, flow in l['r']:
                    rows[strike] = (oi, flow)
        if not rows: continue
        ks = sorted(rows)
        oi = [rows[k][0] for k in ks]; fl = [rows[k][1] for k in ks]
        pre = cutname.lower()
        out[f'{pre}_net_settled'] = sum(oi); out[f'{pre}_net_live'] = sum(fl)
        out[f'{pre}_age_s'] = round((T - lastat) / 1000)
        cum, flip, best = 0.0, None, None
        for i, k in enumerate(ks):
            prev = cum; cum += fl[i]
            if i and (prev < 0) != (cum < 0):
                if best is None or abs(k - spot) < best: best, flip = abs(k - spot), k
        out[f'{pre}_flip_proxy_pct'] = None if flip is None else round((flip / spot - 1) * 100, 3)
        above = [(fl[i], k) for i, k in enumerate(ks) if k >= spot]
        below = [(fl[i], k) for i, k in enumerate(ks) if k <= spot]
        if above: out[f'{pre}_poswall_above_pct'] = round((max(above)[1] / spot - 1) * 100, 3)
        if below: out[f'{pre}_negwall_below_pct'] = round((min(below)[1] / spot - 1) * 100, 3)
        sup = max(ks, key=lambda k: abs(rows[k][1])); top_s = max(ks, key=lambda k: abs(rows[k][0]))
        out[f'{pre}_supreme_pct'] = round((sup / spot - 1) * 100, 3)
        out[f'{pre}_settled_top_pct'] = round((top_s / spot - 1) * 100, 3)
        out[f'{pre}_live_ne_settled_top'] = int(sup != top_s)
        near = sum(fl[i] for i, k in enumerate(ks) if abs(k / spot - 1) <= 0.01)
        out[f'{pre}_net_live_1pct'] = near
        out[f'{pre}_gamma_sign'] = 1 if sum(fl) > 0 else -1
    return out

# ---------------- compass engine state ----------------
def compass_open():
    try:
        with urllib.request.urlopen('http://127.0.0.1:8080/api/compass/state', timeout=5) as r:
            d = json.loads(r.read().decode())
        opens = ((d.get('meta') or {}).get('tail') or {}).get('open') or []
        by = defaultdict(int)
        for o in opens: by[o.get('ticker')] += 1
        return dict(by), True
    except Exception:
        return {}, False

def regime():
    # Terrain's vol regime (/api/regime/vol): one shared server read for every viewer
    try:
        with urllib.request.urlopen('http://127.0.0.1:8080/api/regime/vol', timeout=5) as r:
            d = json.loads(r.read().decode())
        q = {x['sym']: x.get('price') for x in d.get('quotes', [])}
        ra = {x['key']: x.get('value') for x in d.get('ratios', [])}
        return {'vol_regime': d.get('regime'), 'vix1d': q.get('VIX1D'), 'vvix': q.get('VVIX'),
                'vix9d_vix': ra.get('VIX9D/VIX'), 'vix_vix3m': ra.get('VIX/VIX3M'), 'contango': int(d.get('regime') == 'contango')}
    except Exception:
        return {}

# ---------------- per-underlying price state ----------------
class Under:
    __slots__ = ('px', 'cumv', 'vnum', 'vden', 'open', 'hi', 'lo', 'atm_iv', 'atm_iv_min', 'lastv')
    def __init__(self):
        self.px = {}  # minute index -> price
        self.cumv = None; self.vnum = 0.0; self.vden = 0.0
        self.open = None; self.hi = None; self.lo = None
        self.atm_iv = None; self.atm_iv_min = None; self.lastv = None
U = defaultdict(Under)

def midx(minute):
    return (int(minute[:2]) * 60 + int(minute[2:])) - 570

def ret(u, i, k):
    a, b = u.px.get(i), u.px.get(i - k)
    if a is None or b is None or b <= 0: return None
    return round((a / b - 1) * 100, 4)

def realized(u, i):
    xs = [u.px[j] for j in sorted(u.px) if j <= i]
    if len(xs) < 6: return None
    lr = [math.log(xs[j] / xs[j - 1]) for j in range(1, len(xs)) if xs[j - 1] > 0 and xs[j] > 0]
    if len(lr) < 5: return None
    m = sum(lr) / len(lr)
    var = sum((x - m) ** 2 for x in lr) / (len(lr) - 1)
    return math.sqrt(var * 390 * 252)

# ---------------- movers state ----------------
minask = {}   # key -> (ask, minute, delta, under)
hit = defaultdict(set)
if os.path.exists(f'{OUT}/movers.jsonl'):
    for l in open(f'{OUT}/movers.jsonl'):
        try:
            e = json.loads(l); hit[(e['sym'], e['exp'], e['contract'].split()[2][:-1], e['right'])].add(e['threshold'])
        except Exception:
            pass
mv_out = open(f'{OUT}/movers.jsonl', 'a', buffering=1)

def process(minute, replay=False):
    i = midx(minute); T = tms(minute)
    pull_streams()
    # underlying prices
    with gzip.open(f'{OUT}/under-{minute}.csv.gz', 'rt') as fh:
        for r in csv.DictReader(fh):
            s = r['symbol']; last = f(r['last'])
            if not last: continue
            u = U[s]; u.px[i] = last
            vol = f(r['volume'])
            if vol is not None:
                if u.cumv is not None and vol >= u.cumv:
                    u.vnum += (vol - u.cumv) * last; u.vden += vol - u.cumv
                u.cumv = vol
            o, h, l = f(r['open']), f(r['high']), f(r['low'])
            if o: u.open = o
            if h: u.hi = h
            if l: u.lo = l
            if not o:  # index: build open/range from our own snapshots
                if u.open is None: u.open = last
                u.hi = max(u.hi or last, last); u.lo = min(u.lo or last, last)
    # chains: ATM IV, mover detection
    chain_rows = []
    with gzip.open(f'{OUT}/chain-{minute}.csv.gz', 'rt') as fh:
        chain_rows = list(csv.DictReader(fh))
    atm = {}
    refreshed = set()
    for r in chain_rows:
        sym = r['sym']; refreshed.add(sym)
        d = f(r['delta']); iv = f(r['iv']); und = f(r['under'])
        if r['kind'] == 'F' and d is not None and iv and iv > 0:
            gap = abs(abs(d) - 0.5)
            if sym not in atm or gap < atm[sym][0]: atm[sym] = (gap, iv)
        if sym not in PRICE_OF and sym not in U and und:
            pass
        if sym in ('RUTW',) and und:  # RUT has no index snapshot here: use the chain's underlying
            u = U['RUT']; u.px[i] = und; u.open = u.open or und
            u.hi = max(u.hi or und, und); u.lo = min(u.lo or und, und)
        bid, ask = f(r['bid']), f(r['ask'])
        if bid is None or ask is None or ask <= 0 or bid > ask: continue
        key = (sym, r['exp'], r['strike'], r['right'])
        prev = minask.get(key)
        if prev and bid > 0:
            mult = bid / prev[0]
            for k in THRESH:
                if mult >= k and k not in hit[key]:
                    hit[key].add(k)
                    ev = {'contract': f'{sym} {r["exp"]} {r["strike"]}{r["right"]}', 'sym': sym, 'exp': r['exp'],
                          'strike': f(r['strike']), 'right': r['right'], 'threshold': k,
                          'entry_minute': prev[1], 'entry_ask': prev[0], 'entry_delta': prev[2], 'entry_under': prev[3],
                          'exit_minute': minute, 'exit_bid': bid, 'exit_under': und, 'multiple': round(mult, 3),
                          'exit_kind': r['kind'], 'exit_q_ts': r['q_ts'] or r['g_ts'], 'exit_bid_size': r['bid_size'],
                          'entry_snapshot': f'chain-{prev[1]}.csv.gz', 'entry_context': f'ctx-{prev[1]}.csv.gz',
                          'logged_at': dt.datetime.now(ET).isoformat(timespec='seconds')}
                    if not replay: mv_out.write(json.dumps(ev) + '\n')
        if r['kind'] == 'F' and (prev is None or ask < prev[0]):
            minask[key] = (ask, minute, f(r['delta']), und)
    for sym, (gap, iv) in atm.items():
        ps = PRICE_OF.get(sym, 'RUT' if sym == 'RUTW' else sym)
        U[ps].atm_iv = iv; U[ps].atm_iv_min = minute
        if ps != sym: U[sym].atm_iv = iv; U[sym].atm_iv_min = minute
    if replay:
        return
    engine, eng_ok = compass_open()
    reg = regime()
    # SPY vol shock: |15-min return| > 2.5 sd implied by SPY ATM IV
    spy = U['SPY']; r15 = ret(spy, i, 15); shock = None
    if r15 is not None and spy.atm_iv:
        sd15 = spy.atm_iv * math.sqrt(15 / (390 * 252)) * 100
        shock = int(abs(r15) > 2.5 * sd15)
    vix = U['VIX']; vix_now = vix.px.get(i); vix_15 = ret(vix, i, 15)
    win = {w: T - w * 60000 for w in (1, 5, 15)}
    fl_by = defaultdict(lambda: defaultdict(float))
    for (t, tk, prem, is_call, askp, sweep) in flows:
        if t > T or t < win[15]: continue
        for w in (1, 5, 15):
            if t >= win[w]:
                fb = fl_by[tk]
                fb[f'flow{w}_n'] += 1; fb[f'flow{w}_prem'] += prem
                fb[f'flow{w}_callprem'] += prem if is_call else 0.0; fb[f'flow{w}_askprem'] += askp
                fb[f'flow{w}_sweeps'] += 1 if sweep else 0
    nw_by = defaultdict(int); nw_major = defaultdict(int); news_all = 0
    for (t, tks, major) in news:
        if t > T or t < win[15]: continue
        news_all += 1
        for tk in tks:
            nw_by[tk] += 1; nw_major[tk] += 1 if major else 0
    rows = []
    for sym in UNIV:
        ps = PRICE_OF.get(sym, 'RUT' if sym == 'RUTW' else sym)
        u = U.get(ps)
        if u is None or i not in u.px: continue
        sc = SCALE.get(sym, 1.0)
        px = u.px[i]
        vwap = (u.vnum / u.vden) if u.vden > 0 else None
        rv = realized(u, i)
        iv = U[sym].atm_iv if U[sym].atm_iv else u.atm_iv
        ivmin = U[sym].atm_iv_min if U[sym].atm_iv else u.atm_iv_min
        row = {'minute': minute, 'mod': i, 'sym': sym, 'price': round(px * sc, 4),
               'vwap_dev_pct': None if not vwap else round((px / vwap - 1) * 100, 4),
               'from_open_pct': None if not u.open else round((px / u.open - 1) * 100, 4),
               'range_pos': None if not (u.hi and u.lo and u.hi > u.lo) else round((px - u.lo) / (u.hi - u.lo), 4),
               'range_pct': None if not (u.hi and u.lo and u.lo > 0) else round((u.hi / u.lo - 1) * 100, 4),
               'ret1': ret(u, i, 1), 'ret5': ret(u, i, 5), 'ret15': ret(u, i, 15),
               'rv_so_far': None if rv is None else round(rv, 4), 'atm_iv': iv,
               'rv_iv_ratio': None if (rv is None or not iv) else round(rv / iv, 4),
               'atm_iv_age_min': None if not ivmin else i - midx(ivmin),
               'chain_refreshed': int(sym in refreshed),
               'spy_shock15': shock, 'spy_ret15': r15, 'vix': vix_now, 'vix_chg15_pct': vix_15,
               'news15_all': news_all, 'news15': nw_by.get(sym, 0) + (nw_by.get(BOOK_OF.get(sym, ''), 0)),
               'news15_major': nw_major.get(sym, 0),
               'engine_open': engine.get(sym, 0), 'engine_ok': int(eng_ok), **reg}
        fb = fl_by.get(BOOK_OF.get(sym, sym)) or fl_by.get(sym) or {}
        for w in (1, 5, 15):
            n = fb.get(f'flow{w}_n', 0); prem = fb.get(f'flow{w}_prem', 0.0)
            row[f'flow{w}_n'] = int(n); row[f'flow{w}_prem'] = round(prem)
            row[f'flow{w}_call_share'] = None if prem <= 0 else round(fb.get(f'flow{w}_callprem', 0) / prem, 3)
            row[f'flow{w}_ask_share'] = None if prem <= 0 else round(fb.get(f'flow{w}_askprem', 0) / prem, 3)
            row[f'flow{w}_sweeps'] = int(fb.get(f'flow{w}_sweeps', 0))
        bk = BOOK_OF.get(sym, sym)
        if os.path.exists(f'{EXPO}/{bk}.jsonl'):
            row.update(book_features(bk, U[PRICE_OF.get(bk, bk)].px.get(i) if bk == 'SPX' else px, T))
        rows.append(row)
    cols = []
    for r in rows:
        for k in r:
            if k not in cols: cols.append(k)
    with gzip.open(f'{OUT}/ctx-{minute}.csv.gz.tmp', 'wt') as fh:
        w = csv.DictWriter(fh, fieldnames=cols); w.writeheader(); w.writerows(rows)
    os.replace(f'{OUT}/ctx-{minute}.csv.gz.tmp', f'{OUT}/ctx-{minute}.csv.gz')
    log('ctx', minute, 'names', len(rows), 'chain_rows', len(chain_rows), 'flows', len(flows), 'news', len(news),
        'tracked', len(minask), 'hits', sum(len(v) for v in hit.values()), 'engine_ok', eng_ok)

def main():
    done = set()
    while True:
        files = sorted(glob.glob(f'{OUT}/chain-*.csv.gz'))
        todo = [os.path.basename(p)[6:10] for p in files]
        todo = [m for m in todo if m not in done and os.path.exists(f'{OUT}/under-{m}.csv.gz')]
        for m in todo:
            try:
                process(m, replay=os.path.exists(f'{OUT}/ctx-{m}.csv.gz'))
            except Exception as e:
                import traceback
                log('fail', m, repr(e)[:300], traceback.format_exc()[-800:])
            done.add(m)
        if '1600' in done: break
        if dt.datetime.now(ET).strftime('%H%M') > '1605': break
        time.sleep(5)
    log('done')

if __name__ == '__main__':
    main()
