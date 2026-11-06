# The Compass golden test's reference row: the 56 model inputs for SPY 505C at 10:30 ET on the hand-built session in
# scripts/golden/compassScenario.ts, rebuilt here from each column's definition (no app code), then scored by
# LightGBM's own Booster.predict. Writes scripts/golden/compass-ref.json.
# Run: python -I scripts/golden/compass-ref.py .   (needs numpy and lightgbm)
import json, math, sys
import numpy as np, lightgbm as lgb

root = sys.argv[1]
R, T_EPS = 0.042, 1e-6

def bar(k):
    o = 500 + 0.05 * k + 0.3 * math.sin(k)
    return dict(o=o, h=o + 0.2 + 0.01 * (k % 7), l=o - 0.2, v=1000 + 20 * k)

bars = [bar(k) for k in range(61)]
t = 60
o = [b['o'] for b in bars]; h = [b['h'] for b in bars]; l = [b['l'] for b in bars]; v = [b['v'] for b in bars]
S, op = o[t], o[0]

def sd(xs):  # sample standard deviation
    m = sum(xs) / len(xs)
    return math.sqrt(sum((x - m) ** 2 for x in xs) / (len(xs) - 1))

# realised vol: one-minute log changes of the minute opens; the last 30 (minutes 31..60) and the 29 before (2..30)
rv30 = sd([math.log(o[i] / o[i - 1]) for i in range(31, 61)])
rvp = sd([math.log(o[i] / o[i - 1]) for i in range(2, 31)])
# compression: mean high-low of minutes 56..59 over minutes 1..59
rng = lambda a, b: sum(h[i] - l[i] for i in range(a, b)) / (b - a)
compress = rng(56, 60) / rng(1, 60)
# vwap of minutes 1..59 on the opens, and the deviations of each open from the running vwap
pv = vv = 0.0; devs = []
for i in range(1, t):
    pv += o[i] * v[i]; vv += v[i]; devs.append(o[i] - pv / vv)
vwapz = (S - pv / vv) / sd(devs)
H, L = max(h[:t]), min(l[:t])
orh, orl = max(h[:30]), min(l[:30])
# volume against five prior sessions (v = 800 + 100 j + 10 k) at the minute before t (k = 59)
cum_today = sum(v[:t]); last5 = sum(v[t - 5:t])
cum_prior = sorted(sum(800 + 100 * j + 10 * k for k in range(60)) for j in range(1, 6))
five_prior = sorted(sum(800 + 100 * j + 10 * k for k in range(55, 60)) for j in range(1, 6))
med, med5 = cum_prior[2], five_prior[2]

T = (390 - t) / (390 * 252) + T_EPS
N = lambda x: 0.5 * math.erfc(-x / math.sqrt(2))
def bs(K, sig, call):
    vol = sig * math.sqrt(T)
    d1 = (math.log(S / K) + (R + 0.5 * sig * sig) * T) / vol; d2 = d1 - vol
    df = math.exp(-R * T); pdf = math.exp(-0.5 * d1 * d1) / math.sqrt(2 * math.pi)
    px = S * N(d1) - K * df * N(d2) if call else K * df * N(-d2) - S * N(-d1)
    th = -(S * pdf * sig) / (2 * math.sqrt(T)) - (R * K * df * N(d2) if call else -R * K * df * N(-d2))
    return px, (N(d1) if call else N(d1) - 1), pdf / (S * vol), th / 365, S * pdf * math.sqrt(T) / 100
def iv(price, K, call):
    lo, hi = 0.01, 8.0
    if not (bs(K, lo, call)[0] <= price <= bs(K, hi, call)[0]): return float('nan')
    for _ in range(60):
        mid = (lo + hi) / 2
        if bs(K, mid, call)[0] > price: hi = mid
        else: lo = mid
    return (lo + hi) / 2
feat = lambda x: x if x > 0.011 else float('nan')
# ATM pair at 503 (nearest strike to S = 502.91)
c503, p503 = feat(iv((1.80 + 1.84) / 2, 503, True)), feat(iv((1.75 + 1.79) / 2, 503, False))
atm, skew = (c503 + p503) / 2, p503 - c503
# the contract
K, bid, ask = 505, 1.20, 1.24
mid = (bid + ask) / 2
civ = feat(iv(mid, K, True))
_, de, ga, th, ve = bs(K, civ, True)
# open interest 498..508: calls 1000 + 300 i, puts 4000 - 250 i
oi = [(498 + i, 1000 + 300 * i, 4000 - 250 * i) for i in range(11)]
gex = sum((c - p) * bs(k, atm, True)[2] * S * S * 0.01 for k, c, p in oi) / 1e9
call_wall = max((r for r in oi if r[0] >= S and r[1] > 0), key=lambda r: (r[1], -abs(r[0] - S)))[0] / S - 1
put_wall = max((r for r in oi if r[0] <= S and r[2] > 0), key=lambda r: (r[2], -abs(r[0] - S)))[0] / S - 1
nan = float('nan')
ret5, ret15, ret60 = S / o[55] - 1, S / o[45] - 1, S / o[0] - 1
above = S > orh; below = S < orl
x = [nan] * 56
x[0] = t; x[1] = S / op - 1; x[2] = ret5; x[3] = ret15; x[4] = ret60
x[5] = (S - L) / (H - L); x[6] = (H - L) / op; x[7] = rv30; x[8] = rv30 / rvp; x[9] = compress
x[10] = 1 if above else -1 if below else 0
x[11] = (S - orh) / op if above else (S - orl) / op if below else 0
x[12] = S / 505 - 1; x[13] = S / 495 - 1; x[14] = op / 499 - 1; x[15] = 390 - t; x[16] = vwapz
x[17] = cum_today / med; x[18] = last5 / med5
x[19] = ret5; x[20] = ret15; x[21] = S / op - 1  # SPY is its own market tape
x[24] = atm; x[25] = skew; x[26] = atm / (rv30 * math.sqrt(390 * 252))
x[27] = gex; x[28] = call_wall; x[29] = put_wall
x[30] = K / S - 1; x[31] = 1; x[32] = mid; x[33] = (ask - bid) / mid; x[34] = mid / 1.10 - 1; x[35] = mid / 1.00 - 1
x[36] = civ; x[37] = de; x[38] = ga; x[39] = th; x[40] = ve; x[41] = ga / abs(th); x[42] = th / mid
x[43] = 1000 + 300 * 7; x[44] = 1; x[45] = 0
x[46:56] = [x[1], x[2], x[3], x[4], x[16], x[11], x[20], x[22], x[12], x[13]]
row = np.array([x], dtype=np.float32).astype(np.float64)
entry = lgb.Booster(model_file=f'{root}/public/models/model_entry_all6months.txt').predict(row)[0]
runner = lgb.Booster(model_file=f'{root}/public/models/model_runner_all6months.txt').predict(row)[0]
enc = lambda v: None if math.isnan(v) else float(str(np.float32(v)))
out = {'source': 'scripts/golden/compass-ref.py, LightGBM %s' % lgb.__version__, 'x': [enc(v) for v in row[0]], 'entry': float(entry), 'runner': float(runner)}

# ---- Feature version 2 (Group B): the same contract on the trading-time clock -------------------------------------
# T is the regular-session minutes from the mark to the expiry's close (each session ahead with its own close, an early
# close 13:00, holidays and weekends skipped; time outside the regular session counts nothing), over 390 x 252, + 1e-6.
# The calendar is shared/marketCalendar.mjs, read here as text. Column 15 is those minutes; every column that reads T
# (24-27, 36-42) is solved on it; the rest are version 1's. Here: SPY 505C expiring Friday 2026-10-30, at the same
# Wednesday 10:30 mark (330 + 390 + 390 = 1110 minutes).
import datetime as dt, re, os
cal = open(f'{root}/shared/marketCalendar.mjs').read()
def dates(name):
    body = re.search(name + r' = \[(.*?)\];', cal, re.S).group(1)
    return set(re.findall(r"'(\d{4}-\d{2}-\d{2})'", body))
HOL, EARLY = dates('HOLIDAY_DATES'), dates('EARLY_CLOSE_DATES')
def session_day(d): return d.weekday() < 5 and d.isoformat() not in HOL
def close_min(d): return 13 * 60 if d.isoformat() in EARLY else 16 * 60
def trading_minutes(expiry, day, minute):
    e = dt.date.fromisoformat(expiry); d = dt.date.fromisoformat(day)
    if e < d: return 0
    total = max(0, close_min(d) - max(570, minute)) if session_day(d) else 0
    while d < e:
        d += dt.timedelta(days=1)
        if session_day(d): total += close_min(d) - 570
    return total
cases = {'wed 10:30 -> fri weekly': trading_minutes('2026-10-30', '2026-10-28', 630),
         'thu 21:00 -> fri 0dte (overnight)': trading_minutes('2026-10-30', '2026-10-29', 1260),
         'fri 2026-11-27 12:30, 13:00 close, 0dte': trading_minutes('2026-11-27', '2026-11-27', 750),
         'wed 2026-11-25 10:00 -> fri 11-27 (thanksgiving skipped)': trading_minutes('2026-11-27', '2026-11-25', 600),
         'fri 16:30 curb -> mon weekly': trading_minutes('2026-11-02', '2026-10-30', 990)}
tm = cases['wed 10:30 -> fri weekly']
T = tm / (390 * 252) + T_EPS  # bs() and iv() read T
c503v, p503v = feat(iv((1.80 + 1.84) / 2, 503, True)), feat(iv((1.75 + 1.79) / 2, 503, False))
atm2, skew2 = (c503v + p503v) / 2, p503v - c503v
civ2 = feat(iv(mid, K, True))
_, de2, ga2, th2, ve2 = bs(K, civ2 if civ2 > 0 else atm2, True)
gex2 = sum((c - p) * bs(k, atm2, True)[2] * S * S * 0.01 for k, c, p in oi) / 1e9
x2 = list(x)
x2[15] = tm; x2[24] = atm2; x2[25] = skew2; x2[26] = atm2 / (rv30 * math.sqrt(390 * 252)); x2[27] = gex2
x2[36] = civ2; x2[37] = de2; x2[38] = ga2; x2[39] = th2; x2[40] = ve2; x2[41] = ga2 / abs(th2); x2[42] = th2 / mid
row2 = np.array([x2], dtype=np.float32).astype(np.float64)
out['v2'] = {'expiry': '2026-10-30', 'tm': tm, 'cases': cases, 'x': [enc(v) for v in row2[0]]}
for name, f in (('entry', 'model_entry_v2.txt'), ('runner', 'model_runner_v2.txt')):
    path = f'{root}/public/models/{f}'
    if os.path.exists(path): out['v2'][name] = float(lgb.Booster(model_file=path).predict(row2)[0])
print('v2 tm', tm, 'atm', atm2, 'civ', civ2, 'theta', th2, {k: out['v2'].get(k) for k in ('entry', 'runner')}, cases)
open(f'{root}/scripts/golden/compass-ref.json', 'w').write(json.dumps(out, indent=1))
print('S', S, 'atm', atm, 'skew', skew, 'civ', civ, 'entry', entry, 'runner', runner)
