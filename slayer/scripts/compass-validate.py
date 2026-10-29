# Each of Compass's 56 live inputs against its definition, on a day's real rows.
#
# The server engine logs every row it scores (.cache/compass/rows/YYYY-MM-DD.jsonl). For a sample of the rows it
# scored late (from the quotes and bars ThetaData recorded, so every input is reproducible after the fact), this
# rebuilds the 56 columns from their definitions, here, with no app code: the name's, SPY's and the sector ETF's
# one-minute bars, the prior session, the fifteen sessions of volume before, the expiry's open interest, the
# contract's own one-minute quotes 5 and 15 minutes back, and the chain the scan scored at that mark. It then scores
# each logged row with LightGBM's own Booster.predict and compares it with the app's Model 1 and Model 2.
#
# Run: <venv>/bin/python -I scripts/compass-validate.py <slayer dir> [YYYY-MM-DD] [rows per name]
#      (needs lightgbm and numpy; reads ThetaData through the dev server's /api/theta)
import json, math, os, sys, time, urllib.request, urllib.error, statistics
from collections import defaultdict
from datetime import datetime, timedelta, date
from zoneinfo import ZoneInfo

root = sys.argv[1]
day = sys.argv[2] if len(sys.argv) > 2 else datetime.now(ZoneInfo('America/New_York')).strftime('%Y-%m-%d')
per_name = int(sys.argv[3]) if len(sys.argv) > 3 else 12
base = os.environ.get('THETA_BASE', 'http://127.0.0.1:8080/api/theta')
NY = ZoneInfo('America/New_York')
R, T_EPS = 0.042, 1e-6
nan = float('nan')

INDEX = {'SPX', 'SPXW', 'RUT', 'RUTW', 'VIX', 'XSP', 'NDX', 'NDXP'}
UNDER = {'SPXW': 'SPX', 'NDXP': 'NDX', 'RUTW': 'RUT'}
CORE = {'SPXW', 'NVDA', 'SPY', 'QQQ', 'NDXP', 'IWM', 'TSLA', 'META', 'XSP', 'AVGO', 'MSFT', 'AAPL', 'TLT', 'RUTW', 'AMZN', 'SLV', 'GOOGL', 'GLD', 'SMH', 'XLF'}
CLS_INDEX = {'SPXW', 'SPX', 'NDXP', 'NDX', 'XSP', 'RUTW', 'RUT', 'SPY', 'QQQ', 'IWM', 'DIA', 'VOO', 'RSP'}
CLS_HIGH = set('AFRM AGQ AMC BITX BOIL CLSK COIN CVNA DJT FAS GME HOOD IREN JNUG KOLD LABU MARA MSTR NUGT NVDA NVDL PLTR RIOT SMCI SOXL SOXS SPXL SPXS SPXU SQQQ SVIX SVXY TNA TQQQ TSLA TSLL TZA UPRO UPST UVIX UVXY VXX YINN'.split())
SECTOR = {}
for etf, names in {
    'SMH': 'NVDA AMD AVGO MU TSM ASML AMAT LRCX KLAC MRVL QCOM INTC SMCI ARM ON NXPI ADI TXN SWKS WOLF COHR STX WDC NTAP SOXL SOXS NVDL',
    'BITO': 'COIN MSTR MARA RIOT CLSK IREN HUT CIFR WULF CORZ BITX HOOD',
    'XLE': 'XOM CVX OXY COP DVN EOG APA HAL SLB MPC PSX VLO FANG EQT AR BTU OIH XOP USO UCO',
    'GDX': 'NEM GOLD AEM WPM PAAS AG GDXJ NUGT JNUG SLV GLD AGQ',
    'XLF': 'JPM BAC C WFC GS MS SCHW AXP COF USB TFC KRE FAS DPST ALLY BLK BX KKR APO',
}.items():
    for n in names.split():
        SECTOR[n] = etf

_cache = {}
def theta(path):
    if path in _cache:
        return _cache[path]
    for attempt in range(40):  # the terminal drops its session for a minute at a time: wait for it
        try:
            with urllib.request.urlopen(f'{base}{path}', timeout=120) as r:
                body = json.loads(r.read().decode())
            break
        except urllib.error.HTTPError as e:
            if e.code not in (429, 503) or attempt == 39:
                raise
            time.sleep(5)
    rows = body.get('response', body) if isinstance(body, dict) else body
    flat = []
    for it in rows if isinstance(rows, list) else []:
        if isinstance(it, dict) and isinstance(it.get('data'), list):
            flat.extend(dict(d, **{'_c': it.get('contract')}) for d in it['data'])
        else:
            flat.append(it)
    _cache[path] = flat
    return flat

ymd = lambda d: d.replace('-', '')
def minute_of(ts):
    t = datetime.fromisoformat(ts[:19])
    return t.strftime('%Y%m%d'), t.hour * 60 + t.minute

def bars(sym, d0, d1=None):
    root_ = UNDER.get(sym, sym)
    kind = 'index' if sym in INDEX or root_ in INDEX else 'stock'
    out = []
    for b in theta(f'/{kind}/history/ohlc?symbol={root_}&start_date={ymd(d0)}&end_date={ymd(d1 or d0)}&interval=1m&format=json'):
        if not b.get('close') or float(b['close']) <= 0:
            continue
        d, m = minute_of(b['timestamp'])
        c = float(b['close'])
        out.append(dict(d=d, m=m, o=float(b['open']) or c, h=float(b['high']) or c, l=float(b['low']) or c, c=c, v=float(b.get('volume') or 0)))
    return out

HOLIDAYS = {'2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25'}
def prior_session(d):
    x = date.fromisoformat(d) - timedelta(days=1)
    while x.weekday() >= 5 or x.isoformat() in HOLIDAYS:
        x -= timedelta(days=1)
    return x.isoformat()

def sd(xs):
    if len(xs) < 2:
        return nan
    m = sum(xs) / len(xs)
    return math.sqrt(sum((v - m) ** 2 for v in xs) / (len(xs) - 1))

def tape(rows, index, minute, spot=nan):
    t = minute - 570
    o = [nan] * 392; h = [nan] * 392; l = [nan] * 392; v = [0.0] * 392; op = nan
    for b in rows:
        k = b['m'] - 570
        if k < 0 or k > 390:
            continue
        if not (o[k] > 0) and b['o'] > 0:
            o[k] = b['o']
        h[k] = b['h']; l[k] = b['l']; v[k] = b['v']
        if k == 0 and b['o'] > 0:
            op = b['o']
    if t > 390 and spot > 0:
        S = spot
    elif 0 <= t <= 390 and not (o[t] > 0) and spot > 0:
        S = spot
    else:
        S = next((o[i] for i in range(min(max(t, 0), 391), -1, -1) if o[i] > 0), spot if spot > 0 else nan)
    logs = lambda a, b: [math.log(o[i] / o[i - 1]) for i in range(max(a + 1, 1), b) if o[i] > 0 and o[i - 1] > 0]
    rv = lambda xs: sd(xs) if len(xs) >= 10 else nan
    rv30 = rv(logs(max(1, t - 30), t + 1)); rvp = rv(logs(max(1, t - 60), t - 29))
    comp = nan
    if t >= 60:
        if index:
            ch = lambda n: [o[i] - o[i - 1] for i in range(max(1, t - n + 1), t + 1) if o[i] > 0 and o[i - 1] > 0]
            a, b = sd(ch(5)), sd(ch(60))
        else:
            def mr(n):
                xs = [h[i] - l[i] for i in range(max(1, t - n + 1), t) if not math.isnan(h[i]) and not math.isnan(l[i])]
                return sum(xs) / len(xs) if xs else nan
            a, b = mr(5), mr(60)
        comp = a / b if b > 0 else nan
    pv = vv = 0.0; devs = []
    for i in range(1, min(t, 392)):
        if v[i] > 0 and o[i] > 0:
            pv += o[i] * v[i]; vv += v[i]; devs.append(o[i] - pv / vv)
    vwap = pv / vv if vv > 0 else nan
    s = sd(devs)
    vz = (S - vwap) / s if (not index and s > 0 and S > 0 and vwap > 0) else nan
    cum = sum(v[i] for i in range(0, min(t, 392)))
    last5 = sum(v[i] for i in range(max(0, t - 5), min(t, 392)))
    span = lambda a, lo, hi, mx: (max if mx else min)([x for x in a[lo:hi] if not math.isnan(x)], default=nan)
    at = lambda back: o[t - back] if t - back >= 0 and o[t - back] > 0 else nan
    return dict(t=t, S=S, op=op, H=span(h, 0, t, True), L=span(l, 0, t, False), orh=span(h, 0, 30, True), orl=span(l, 0, 30, False),
                rv30=rv30, rvp=rvp, comp=comp, vz=vz, cum=nan if index else cum, last5=last5, at=at)

N = lambda x: 0.5 * math.erfc(-x / math.sqrt(2))
def bs(S, K, T, sig, call):
    if not (S > 0 and K > 0 and T > 0 and sig > 0):
        return nan, nan, nan, nan, nan
    vol = sig * math.sqrt(T)
    d1 = (math.log(S / K) + (R + 0.5 * sig * sig) * T) / vol; d2 = d1 - vol
    df = math.exp(-R * T); pdf = math.exp(-0.5 * d1 * d1) / math.sqrt(2 * math.pi)
    px = S * N(d1) - K * df * N(d2) if call else K * df * N(-d2) - S * N(-d1)
    th = -(S * pdf * sig) / (2 * math.sqrt(T)) - (R * K * df * N(d2) if call else -R * K * df * N(-d2))
    return px, (N(d1) if call else N(d1) - 1), pdf / (S * vol), th / 365, S * pdf * math.sqrt(T) / 100

def solve(price, S, K, T, call):
    if not (price > 0 and S > 0 and K > 0 and T > 0):
        return nan
    lo, hi = 0.01, 8.0
    if not (bs(S, K, T, lo, call)[0] <= price <= bs(S, K, T, hi, call)[0]):
        return nan
    for _ in range(60):
        mid = (lo + hi) / 2
        if bs(S, K, T, mid, call)[0] > price: hi = mid
        else: lo = mid
    return (lo + hi) / 2
feat = lambda v: v if v > 0.011 else nan

def curve(sym, d):
    if sym in INDEX:
        return None
    end = prior_session(d)
    start = (date.fromisoformat(d) - timedelta(days=21)).isoformat()
    by = defaultdict(list)
    for b in bars(sym, start, end):
        by[b['d']].append(b)
    cum = defaultdict(list); five = defaultdict(list)
    for lst in by.values():
        run = 0; tot = []
        for b in lst:
            run += b['v']; tot.append((b['m'], run))
        for k, (m, total) in enumerate(tot):
            prior = 0
            for mm, tt in tot[:k + 1]:
                if mm <= m - 5: prior = tt
            cum[m].append(total); five[m].append(max(0, total - prior))
    return cum, five

def median(xs):
    return statistics.median(xs) if xs else nan

def mid_at(row, minute):
    ticker, word = row['k'].split(' ')
    K = float(word[:-1]); right = 'call' if word[-1] == 'C' else 'put'
    hm = f'{minute // 60:02d}:{minute % 60:02d}:00'
    q = theta(f'/option/history/quote?symbol={ticker}&expiration={ymd(row["e"])}&strike={K:g}&right={right}&start_date={ymd(day)}&end_date={ymd(day)}&interval=1m&start_time={hm}&end_time={hm}&format=json')
    for r in q:
        if minute_of(r['timestamp'])[1] == minute and float(r['ask']) > 0 and float(r['bid']) >= 0 and float(r['ask']) >= float(r['bid']):
            return (float(r['bid']) + float(r['ask'])) / 2
    return nan

def oi_book(ticker, exp):
    nodes = defaultdict(lambda: [0.0, 0.0])
    for r in theta(f'/option/snapshot/open_interest?symbol={ticker}&expiration={ymd(exp)}&format=json'):
        c = r.get('_c') or r
        k = float(c['strike']); side = str(c['right'])[0].upper()
        nodes[k][0 if side == 'C' else 1] = float(r['open_interest'])
    return nodes

def rebuild(row, chain):
    ticker, word = row['k'].split(' ')
    K = float(word[:-1]); call = word[-1] == 'C'; minute = row['t']
    under = UNDER.get(ticker, ticker); index = ticker in INDEX or under in INDEX
    spot = row['s'] if row['s'] else nan
    tp = tape(bars(ticker, day), index, minute, nan if row.get('late') else spot)
    S, op, t = tp['S'], tp['op'], tp['t']
    if not S > 0:
        return None
    pd_ = bars(ticker, prior_session(day))
    pdh = max(b['h'] for b in pd_) if pd_ else nan; pdl = min(b['l'] for b in pd_) if pd_ else nan; pdc = pd_[-1]['c'] if pd_ else nan
    spy = tape(bars('SPY', day), False, minute)
    etf = '' if ticker == 'SPXW' else SECTOR.get(ticker, SECTOR.get(under, ''))
    sec = tape(bars(etf, day), False, minute) if etf else None
    T = max(0, 390 - t) / (390 * 252) + T_EPS
    # the ATM pair: the nearest strike to S among the chain the scan scored (a tie takes the lower strike)
    strikes = sorted({c['K'] for c in chain})
    atmk = min(strikes, key=lambda k: (abs(k - S), k)) if strikes else nan
    civ_ = {c['call']: feat(solve(c['mid'], S, c['K'], T, c['call'])) for c in chain if c['K'] == atmk}
    cv, pv_ = civ_.get(True, nan), civ_.get(False, nan)
    atm = (cv + pv_) / 2 if cv > 0 and pv_ > 0 else (cv if cv > 0 else pv_)
    skew = pv_ - cv if cv > 0 and pv_ > 0 else nan
    mid = (row['b'] + row['a']) / 2
    civ = feat(solve(mid, S, K, T, call))
    vol = civ if civ > 0.011 else (atm if atm > 0.011 else 0.3)
    _, de, ga, th, ve = bs(S, K, T, vol, call)
    cur = curve(under, day)
    clock = 570 + t - (0 if index else 1)
    med = median(cur[0].get(clock, [])) if cur and len(cur[0].get(clock, [])) >= 5 else nan
    med5 = median(cur[1].get(clock, [])) if cur and len(cur[1].get(clock, [])) >= 5 else nan
    core = ticker in CORE
    gex = cw = pw = oiK = nan
    if core:
        book = oi_book(ticker, row['e'])
        if atm > 0.011 and S > 0:
            gex = sum((c * bs(S, k, T, atm, True)[2] - p * bs(S, k, T, atm, True)[2]) * S * S * 0.01 for k, (c, p) in book.items()) / 1e9
        up = [(k, c) for k, (c, p) in book.items() if k >= S and c > 0]
        dn = [(k, p) for k, (c, p) in book.items() if k <= S and p > 0]
        if up: cw = max(up, key=lambda r: (r[1], -abs(r[0] - S)))[0] / S - 1
        if dn: pw = max(dn, key=lambda r: (r[1], -abs(r[0] - S)))[0] / S - 1
        oiK = book[K][0 if call else 1] if K in book else nan
    ret = lambda back: S / tp['at'](back) - 1 if tp['at'](back) > 0 else nan
    m5, m15 = mid_at(row, minute - 5), mid_at(row, minute - 15)
    d = 1 if call else -1
    x = [nan] * 56
    x[0] = t; x[1] = S / op - 1 if op > 0 else nan; x[2] = ret(5); x[3] = ret(15); x[4] = ret(60) if t >= 60 else nan
    x[5] = (S - tp['L']) / (tp['H'] - tp['L']) if tp['H'] > tp['L'] else nan
    x[6] = (tp['H'] - tp['L']) / op if tp['H'] > 0 and tp['L'] > 0 and op > 0 else nan
    x[7] = tp['rv30']; x[8] = tp['rv30'] / tp['rvp'] if tp['rv30'] > 0 and tp['rvp'] > 0 else nan; x[9] = tp['comp']
    orb = not (t < 30 or math.isnan(tp['orh']))
    x[10] = (1 if S > tp['orh'] else -1 if S < tp['orl'] else 0) if orb else nan
    x[11] = ((S - tp['orh']) / op if S > tp['orh'] else (S - tp['orl']) / op if S < tp['orl'] else 0) if orb and op > 0 else nan
    x[12] = S / pdh - 1 if pdh > 0 else nan; x[13] = S / pdl - 1 if pdl > 0 else nan; x[14] = op / pdc - 1 if pdc > 0 and op > 0 else nan
    x[15] = 390 - t; x[16] = nan if index else tp['vz']
    x[17] = nan if index or not med > 0 else tp['cum'] / med; x[18] = nan if index or not med5 > 0 else tp['last5'] / med5
    x[19] = spy['S'] / spy['at'](5) - 1 if spy['S'] > 0 and spy['at'](5) > 0 else nan
    x[20] = spy['S'] / spy['at'](15) - 1 if spy['S'] > 0 and spy['at'](15) > 0 else nan
    x[21] = spy['S'] / spy['op'] - 1 if spy['S'] > 0 and spy['op'] > 0 else nan
    x[22] = sec['S'] / sec['at'](15) - 1 if sec and sec['S'] > 0 and sec['at'](15) > 0 else nan
    x[23] = sec['S'] / sec['op'] - 1 if sec and sec['S'] > 0 and sec['op'] > 0 else nan
    x[24] = atm; x[25] = skew; x[26] = atm / (tp['rv30'] * math.sqrt(390 * 252)) if atm > 0 and tp['rv30'] > 0 else nan
    x[27] = gex; x[28] = cw; x[29] = pw
    x[30] = K / S - 1 if call else 1 - K / S; x[31] = d; x[32] = mid; x[33] = (row['a'] - row['b']) / mid
    x[34] = mid / m5 - 1 if m5 > 0 else nan; x[35] = mid / m15 - 1 if m15 > 0 else nan
    x[36] = civ; x[37] = de; x[38] = ga; x[39] = th; x[40] = ve
    x[41] = ga / abs(th) if th and not math.isnan(ga) and not math.isnan(th) else nan
    x[42] = th / mid if not math.isnan(th) and mid > 0 else nan
    x[43] = oiK if core else nan; x[44] = 1 if ticker in CLS_INDEX else 0; x[45] = 1 if ticker in CLS_HIGH else 0
    for k, src in zip(range(46, 56), [1, 2, 3, 4, 16, 11, 20, 22, 12, 13]):
        x[k] = x[src] * d
    return x

rows = [json.loads(l) for l in open(os.path.join(root, '.cache', 'compass', 'rows', f'{day}.jsonl'))] if not os.environ.get('ROWS') else [json.loads(l) for l in open(os.environ['ROWS'])]
late = [r for r in rows if r.get('late')]
chains = defaultdict(list)
for r in late:
    tk, word = r['k'].split(' ')
    chains[(r['t'], tk, r['e'])].append(dict(K=float(word[:-1]), call=word[-1] == 'C', mid=(r['b'] + r['a']) / 2))
by_name = defaultdict(list)
for r in late:
    by_name[r['k'].split(' ')[0]].append(r)
sample = []
for name, lst in sorted(by_name.items()):
    step = max(1, len(lst) // per_name)
    sample.extend(lst[::step][:per_name])

f32 = lambda v: v if math.isnan(v) else float(__import__('struct').unpack('f', __import__('struct').pack('f', v))[0])
worst = [dict(n=0, bad=0, max=0.0, ex='') for _ in range(56)]
for r in sample:
    try:
        x = rebuild(r, chains[(r['t'], r['k'].split(' ')[0], r['e'])])
    except Exception as e:  # a row whose history did not answer is left out, and said
        print('skip', r['k'], r['t'], e)
        continue
    if x is None:
        continue
    for i in range(56):
        a = f32(x[i]); b = r['x'][i]
        if math.isnan(a) and b is None:
            continue
        worst[i]['n'] += 1
        err = math.inf if (math.isnan(a) or b is None) else abs(a - b) / max(1e-9, abs(b) if abs(b) > 1e-6 else 1.0)
        if err > 1e-4:
            worst[i]['bad'] += 1
        if err > worst[i]['max']:
            worst[i]['max'] = err; worst[i]['ex'] = f"{r['k']} t={r['t']} rebuilt={a} app={b}"

print(f'{day}: {len(sample)} late-scored rows rebuilt from their definitions ({len(by_name)} names) out of {len(rows)} scored rows')
for i, w in enumerate(worst):
    print(f"x{i:<3} rows {w['n']:<4} off {w['bad']:<4} worst {w['max']:.2e}  {w['ex'] if w['bad'] else ''}")

try:
    import numpy as np, lightgbm as lgb
    X = np.array([[nan if v is None else v for v in r['x']] for r in rows], dtype=np.float32).astype(np.float64)
    e = lgb.Booster(model_file=f'{root}/public/models/model_entry_all6months.txt').predict(X)
    u = lgb.Booster(model_file=f'{root}/public/models/model_runner_all6months.txt').predict(X)
    de = max(abs(a - r['p1']) for a, r in zip(e, rows)); du = max(abs(a - r['p2']) for a, r in zip(u, rows))
    print(f'LightGBM {lgb.__version__} on all {len(rows)} logged rows: Model 1 worst |diff| {de:.2e}, Model 2 {du:.2e}')
except ImportError:
    print('lightgbm not installed: model parity on the real rows not checked')
