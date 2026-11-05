#!/usr/bin/env python3
"""LIVE-SCAN raw collector (forward recorder, no analysis).

Once a minute 09:30-16:00 ET:
  tier A (every minute): SPY QQQ IWM SPXW 0DTE + NVDA TSLA AAPL AMD META AMZN MSFT GOOGL nearest expiry
  tier B (rolling):      every other name of the engine's 458-name universe, nearest expiry, as many names
                         as fit in the minute's time budget (target: each refreshed <= every 5 min)
  every minute: one multi-symbol stock snapshot OHLC (cum volume) for all stock roots, SPX/NDX/RUT index snapshot.
Chain reads are BULK (greeks/all + quote per root/expiry; never per contract). <=2 concurrent requests, backoff
on 429/503/timeouts. The terminal is shared with the live Compass engine: the budget per minute is capped and
shrinks automatically if requests get slow.

Stored contract rows: a FULL row when the contract is a candidate now (|delta| 0.10-0.60, ask >= 0.10,
spread <= 15% of mid); a SLIM row (bid/ask/delta only) when it was a candidate earlier today (needed to see a
later exit bid). Everything else is dropped.
"""
import csv, gzip, io, json, os, sys, time, datetime as dt, urllib.request, urllib.error, glob
from concurrent.futures import ThreadPoolExecutor
from collections import defaultdict
from zoneinfo import ZoneInfo

ET = ZoneInfo('America/New_York')
TD = 'http://127.0.0.1:25503/v3'
DAY = sys.argv[1] if len(sys.argv) > 1 else dt.datetime.now(ET).strftime('%Y-%m-%d')
D8 = DAY.replace('-', '')
OUT = f'/home/user/falcon-cloud-field-sail/v2data/live/scan/{DAY}'
os.makedirs(OUT, exist_ok=True)
HERE = os.path.dirname(os.path.abspath(__file__))
UNIV = json.load(open(os.path.join(HERE, '../../../public/config/universe_458.json')))
INDEX_ROOTS = {'SPXW': 'SPX', 'SPX': 'SPX', 'NDXP': 'NDX', 'NDX': 'NDX', 'XSP': 'XSP', 'RUTW': 'RUT', 'RUT': 'RUT',
               'VIX': 'VIX', 'VIXW': 'VIX', 'DJX': 'DJX', 'MRUT': 'MRUT', 'OEX': 'OEX', 'XEO': 'XEO'}
TIER_A = ['SPY', 'QQQ', 'IWM', 'SPXW', 'NVDA', 'TSLA', 'AAPL', 'AMD', 'META', 'AMZN', 'MSFT', 'GOOGL']
TIER_B = [s for s in UNIV if s not in TIER_A]
STOCKS = [s for s in UNIV if s not in INDEX_ROOTS]
BUDGET_S = float(os.environ.get('SCAN_BUDGET_S', '44'))   # seconds of each minute we may use
LOG = open(f'{OUT}/collector.log', 'a', buffering=1)
health = {'ok': 0, 'err': 0, 'retry': 0, 'slow': 0}

def log(*a):
    LOG.write(dt.datetime.now(ET).strftime('%H:%M:%S ') + ' '.join(str(x) for x in a) + '\n')

def get(path, tries=4, timeout=25):
    wait = 2.0
    for i in range(tries):
        t0 = time.time()
        try:
            with urllib.request.urlopen(TD + path, timeout=timeout) as r:
                body = r.read().decode()
            health['ok'] += 1
            if time.time() - t0 > 5: health['slow'] += 1
            return body
        except urllib.error.HTTPError as e:
            if e.code in (429, 503, 502, 504) and i < tries - 1:
                health['retry'] += 1; log('backoff', e.code, path[:90]); time.sleep(wait); wait *= 2; continue
            if e.code in (404, 472, 400):
                health['ok'] += 1; return ''
            health['err'] += 1; log('http', e.code, path[:90]); return None
        except Exception as e:
            if i < tries - 1:
                health['retry'] += 1; log('exc', repr(e)[:100], path[:90]); time.sleep(wait); wait *= 2; continue
            health['err'] += 1; log('fail', repr(e)[:100], path[:90]); return None

def rows(txt):
    if not txt: return []
    return list(csv.DictReader(io.StringIO(txt)))

# ---------------- expirations (nearest >= today, per root) ----------------
EXP_FILE = f'{OUT}/expirations.json'
def load_exps():
    if os.path.exists(EXP_FILE):
        return json.load(open(EXP_FILE))
    return {}
EXPS = load_exps()
def nearest_exp(sym):
    if sym in EXPS: return EXPS[sym]
    txt = get(f'/option/list/expirations?symbol={sym}&format=csv')
    best = None
    for r in rows(txt):
        e = (r.get('expiration') or '').replace('-', '')
        if e >= D8 and (best is None or e < best): best = e
    EXPS[sym] = best
    return best

# ---------------- contract state ----------------
EVER = set()   # contract keys that were a candidate earlier today
for fp in sorted(glob.glob(f'{OUT}/chain-*.csv.gz')):
    try:
        with gzip.open(fp, 'rt') as f:
            for r in csv.DictReader(f):
                if r.get('kind') == 'F': EVER.add((r['sym'], r['exp'], r['strike'], r['right']))
    except Exception:
        pass

def fnum(x):
    try: return float(x)
    except Exception: return None

FULL_HDR = ['minute', 'kind', 'sym', 'exp', 'strike', 'right', 'g_ts', 'bid', 'ask', 'bid_size', 'ask_size', 'q_ts',
            'delta', 'gamma_bs', 'theta', 'vega', 'iv', 'under', 'under_ts']

LAST_CAND = {}   # name -> candidate rows at its last refresh
SKIPS = defaultdict(int)
WITH_QUOTE = set(TIER_A)  # tier B: greeks/first_order only (it carries bid/ask); the quote call (sizes) is tier A only

def fetch_chain(sym):
    exp = nearest_exp(sym)
    if not exp: return sym, []
    t0 = time.time()
    g = rows(get(f'/option/snapshot/greeks/first_order?symbol={sym}&expiration={exp}&format=csv'))
    t1 = time.time(); TIMES['greeks'] += t1 - t0
    if not g:
        LAST_CAND[sym] = 0; return sym, []
    q = rows(get(f'/option/snapshot/quote?symbol={sym}&expiration={exp}&format=csv')) if sym in WITH_QUOTE else []
    TIMES['quote'] += time.time() - t1
    tyears = max(60.0, (dt.datetime.strptime(exp + ' 16:00', '%Y%m%d %H:%M').replace(tzinfo=ET) - dt.datetime.now(ET)).total_seconds()) / (365 * 86400)
    qm = {(r['strike'], r['right'][0]): r for r in q}
    out = []
    for r in g:
        bid, ask, delta = fnum(r['bid']), fnum(r['ask']), fnum(r['delta'])
        if ask is None or bid is None or delta is None: continue
        right = r['right'][0]
        key = (sym, exp, r['strike'], right)
        qq = qm.get((r['strike'], right), {})
        # prefer the quote endpoint's NBBO when it is at least as fresh (it carries sizes)
        qb, qa = fnum(qq.get('bid')), fnum(qq.get('ask'))
        if qb is not None and qa is not None and qa > 0 and (qq.get('timestamp', '') >= r['timestamp']):
            bid, ask = qb, qa
        mid = (bid + ask) / 2
        cand = (0.10 <= abs(delta) <= 0.60 and ask >= 0.10 and bid > 0 and mid > 0 and (ask - bid) / mid <= 0.15)
        if cand:
            EVER.add(key)
            out.append(['F', sym, exp, r['strike'], right, r['timestamp'], bid, ask, qq.get('bid_size', ''),
                        qq.get('ask_size', ''), qq.get('timestamp', ''), delta, bs_gamma(fnum(r['underlying_price']), fnum(r['strike']), fnum(r['implied_vol']), tyears), r['theta'], r['vega'],
                        r['implied_vol'], r['underlying_price'], r['underlying_timestamp']])
        elif key in EVER:
            out.append(['S', sym, exp, r['strike'], right, r['timestamp'], bid, ask, qq.get('bid_size', ''),
                        qq.get('ask_size', ''), '', delta, '', '', '', r['implied_vol'], r['underlying_price'], ''])
    LAST_CAND[sym] = len(out)  # candidate rows + rows of earlier candidates (their later bids are exits)
    return sym, out

def fetch_stocks():
    t0 = time.time()
    out = []
    for i in range(0, len(STOCKS), 100):
        out += rows(get('/stock/snapshot/ohlc?symbol=' + ','.join(STOCKS[i:i + 100]) + '&format=csv'))
    TIMES['stocks'] += time.time() - t0
    return out

def fetch_index():
    out = []
    for s in ['SPX', 'NDX', 'RUT', 'VIX']:
        for r in rows(get(f'/index/snapshot/price?symbol={s}&format=csv')):
            r['symbol'] = s; out.append(r)
    return out

TIMES = {'greeks': 0.0, 'quote': 0.0, 'stocks': 0.0}

def bs_gamma(S, K, iv, T):
    # gamma computed locally (Black-Scholes, r=q=0) from the vendor's IV: first_order snapshots carry no gamma
    import math
    try:
        if not (S and K and iv and iv > 0 and T > 0): return ''
        d1 = (math.log(S / K) + 0.5 * iv * iv * T) / (iv * math.sqrt(T))
        return round(math.exp(-0.5 * d1 * d1) / math.sqrt(2 * math.pi) / (S * iv * math.sqrt(T)), 6)
    except Exception:
        return ''

ptr = {'b': 0}
STATE = f'{OUT}/collector-state.json'
if os.path.exists(STATE):
    try:
        st = json.load(open(STATE)); ptr['b'] = st['ptr']; LAST_CAND.update(st['last_cand'])
    except Exception:
        pass
refreshed_at = {}

def one_minute(tag, start):
    deadline = start + BUDGET_S
    done = []
    with ThreadPoolExecutor(max_workers=2) as ex:
        stocks_f = ex.submit(fetch_stocks)
        idx = fetch_index()
        res = list(ex.map(fetch_chain, TIER_A))
        stocks = stocks_f.result()
        # tier B: rolling pointer, pairs of names while time remains
        while time.time() < deadline - 3:
            batch = []
            guard = 0
            while len(batch) < 2 and guard < len(TIER_B):
                nm = TIER_B[ptr['b'] % len(TIER_B)]; ptr['b'] += 1; guard += 1
                # a name whose last chain had no candidate is visited every 3rd pass only
                if LAST_CAND.get(nm, 1) == 0 and SKIPS[nm] < 2:
                    SKIPS[nm] += 1; continue
                SKIPS[nm] = 0; batch.append(nm)
            res += list(ex.map(fetch_chain, batch))
            done += batch
    n = 0
    with gzip.open(f'{OUT}/chain-{tag}.csv.gz', 'wt') as f:
        w = csv.writer(f); w.writerow(FULL_HDR)
        for sym, rr in res:
            refreshed_at[sym] = tag
            for r in rr:
                w.writerow([tag] + r); n += 1
    with gzip.open(f'{OUT}/under-{tag}.csv.gz', 'wt') as f:
        w = csv.writer(f); w.writerow(['minute', 'symbol', 'ts', 'open', 'high', 'low', 'last', 'volume', 'count'])
        for r in stocks:
            w.writerow([tag, r.get('symbol'), r.get('timestamp'), r.get('open'), r.get('high'), r.get('low'),
                        r.get('close'), r.get('volume'), r.get('count')])
        for r in idx:
            w.writerow([tag, r['symbol'], r.get('timestamp'), '', '', '', r.get('price'), '', ''])
    json.dump(EXPS, open(EXP_FILE + '.tmp', 'w')); os.replace(EXP_FILE + '.tmp', EXP_FILE)
    json.dump({'ptr': ptr['b'], 'last_cand': LAST_CAND}, open(STATE + '.tmp', 'w')); os.replace(STATE + '.tmp', STATE)
    cov = {'names_with_cand': sum(1 for v in LAST_CAND.values() if v > 0), 'names_seen': len(LAST_CAND), 'tierA': len(TIER_A), 'tierB_this_min': len(done), 'tierB_ptr': ptr['b'],
           'cycle_min_est': round(len(TIER_B) / max(1, len(done)), 1)}
    with open(f'{OUT}/coverage.jsonl', 'a') as f:
        f.write(json.dumps({'minute': tag, 'rows': n, 'secs': round(time.time() - start, 1), **cov,
                            'health': dict(health), 'ever': len(EVER), 'refreshed': [sym for sym, _ in res], 'req_secs': {k: round(v, 1) for k, v in TIMES.items()}}) + '\n')
    for k in TIMES: TIMES[k] = 0.0
    log('minute', tag, 'rows', n, 'secs', round(time.time() - start, 1), cov, health)

def main():
    open_t = dt.datetime.strptime(DAY + ' 09:30', '%Y-%m-%d %H:%M').replace(tzinfo=ET)
    close_t = dt.datetime.strptime(DAY + ' 16:00', '%Y-%m-%d %H:%M').replace(tzinfo=ET)
    while True:
        now = dt.datetime.now(ET)
        nxt = now.replace(second=1, microsecond=0)
        if nxt <= now: nxt += dt.timedelta(minutes=1)
        if nxt < open_t: nxt = open_t.replace(second=1)
        if nxt > close_t + dt.timedelta(seconds=30): break
        time.sleep(max(0, (nxt - dt.datetime.now(ET)).total_seconds()))
        tag = nxt.strftime('%H%M')
        try:
            one_minute(tag, time.time())
        except Exception as e:
            log('minute_fail', tag, repr(e)[:300])
    log('done', health)

if __name__ == '__main__':
    main()
