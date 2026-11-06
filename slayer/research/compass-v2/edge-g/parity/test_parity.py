"""EDGE-G parity test (PREREG): the Python port (gex.py) against Pinpoint's audited TS definitions.

  python3 parity/test_parity.py            -> parity/PARITY.md (+ exit 1 on any failure)

(A) algorithm: the same legs through gex.py and through the app's own core/gammaFlip.ts + core/walls.ts (tsx):
    flip, netAtSpot, every crossing, netGammaAt at 25 prices, pickLegWalls -> 1e-9 relative.
    Legs: the recorded pinpoint-2026-10-29 SPY/NVDA books (today, all), 40 synthetic books (narrow same-day legs,
    outright far wings, OI caps, s0 != spot, t0), and DEV history books built by book.py (when present).
(B) recorded book: net, call wall, put wall, supreme read by Python straight off the raw fixture rows must equal the
    golden's GOLD exactly; the Python flip on pinpointRaw's priced legs of the rows within 0.02% of spot of GOLD.
"""
import glob, gzip, json, os, subprocess, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..'))
import gex  # noqa: E402

SLAYER = os.path.abspath(os.path.join(HERE, '..', '..', '..', '..'))
FIX = os.path.join(SLAYER, 'scripts', 'fixtures', 'golden', 'pinpoint-2026-10-29')
TSX = os.path.join(SLAYER, 'node_modules', '.bin', 'tsx')
SCR = os.environ.get('EDGEG_SCRATCH', '/tmp/claude-0/-home-user/f71fb141-33a0-5344-9573-1a2ad4706812/scratchpad')
GOLD = {  # scripts/golden/pinpoint-golden.ts
    'SPY': {'today': (107_689_622.85, 771.1081929770314, 775, 758, 758), 'all': (-3_576_479_393.82, 775.549780158155, 800, 750, 750)},
    'NVDA': {'today': (280_962_174.09, 209.49980850770302, 217.5, 210, 217.5), 'all': (545_826_799.8, 209.01346307467432, 220, 200, 220)},
}
FRONT = {'SPY': '2026-10-29', 'NVDA': '2026-10-30'}


def raw_rows(t):
    rows = []
    for f in glob.glob(os.path.join(FIX, '*.json.gz')):
        saved = json.loads(gzip.open(f).read().decode())
        if not saved['path'].startswith(f'/stock/{t}/spot-exposures/expiry-strike?limit=500&page='):
            continue
        body = json.loads(saved['body'])
        rows += body['data'] if isinstance(body, dict) and 'data' in body else body
    return rows


def num(v):
    try:
        return float(v)
    except Exception:
        return 0.0


def legs_json(L):
    out = []
    for i in range(len(L['strike'])):
        d = {'strike': float(L['strike'][i]), 'g0': float(L['g0'][i]), 'iv': float(L['iv'][i]), 't': float(L['t'][i])}
        if L['s0'][i]:
            d['s0'] = float(L['s0'][i])
        if L['oi'][i]:
            d['oi'] = float(L['oi'][i])
        if L['side'][i]:
            d['side'] = int(L['side'][i])
        if L['own'][i]:
            d['ownIv'] = True
        if L['t0'][i]:
            d['t0'] = float(L['t0'][i])
        out.append(d)
    return out


def priced_to_legs(priced):
    """pinpointRaw Priced (vendor sign) -> GammaLeg arrays (house sign)."""
    k, g0, iv, t, s0, oi, side = [], [], [], [], [], [], []
    for grp in priced:
        for l in grp['legs']:
            k.append(l['k']); g0.append(-l['g0']); iv.append(l['iv']); t.append(l['t']); s0.append(grp['s0'])
            oi.append(l['oi']); side.append(-l['side'])
    iv = np.array(iv, float)
    return gex.make_legs(strike=k, g0=g0, iv=iv, t=t, s0=s0, oi=oi, side=side, own=iv > 0)


def synthetic(seed):
    rng = np.random.default_rng(seed)
    spot = float(rng.uniform(50, 6000))
    n = int(rng.integers(20, 400))
    K = spot * np.exp(rng.normal(0, 0.06, n))
    t = np.where(rng.random(n) < 0.4, rng.uniform(5, 390, n) / (390 * 252), rng.uniform(1, 40, n) / 252)
    iv = np.where(rng.random(n) < 0.1, 0.0, rng.uniform(0.08, 1.2, n))
    side = np.where(rng.random(n) < 0.5, -1, 1)
    oi = np.where(rng.random(n) < 0.8, rng.integers(1, 50000, n), 0)
    s0 = np.where(rng.random(n) < 0.3, spot * (1 + rng.normal(0, 0.004, n)), 0.0)
    own = rng.random(n) < 0.7
    t0 = np.where(rng.random(n) < 0.1, t + rng.uniform(1, 60, n) / (390 * 252), 0.0)
    g = gex.dollar_gamma_per_contract(np.where(s0 > 0, s0, spot), K, np.where(t0 > 0, t0, t), np.where(iv > 0, iv, 0.3))
    g0 = side * np.maximum(oi, rng.integers(1, 3000, n)) * g * rng.uniform(0.5, 1.5, n)
    return spot, gex.make_legs(strike=K, g0=g0, iv=iv, t=t, s0=s0, oi=oi, side=side, own=own, t0=t0)


def rel(a, b):
    if a is None or b is None:
        return 0.0 if a is None and b is None else np.inf
    return abs(a - b) / max(1.0, abs(b))


def main():
    lines = ['# EDGE-G parity test: gex.py vs Pinpoint TS definitions', '']
    ok_all = True
    cases, py = [], []
    dump = os.path.join(SCR, 'fixture_dump.json')
    subprocess.run([TSX, os.path.join(HERE, 'dump_fixture.ts'), dump], cwd=SLAYER, check=True, capture_output=True)
    fx = json.load(open(dump))
    lines += ['## (B) the recorded book pinpoint-2026-10-29 (Python off the raw rows vs pinpoint-golden.ts GOLD)', '',
              '| name | scope | net (py) | net GOLD | walls+supreme py | GOLD | flip py | flip GOLD | |flip diff|/spot | pass |',
              '|---|---|---:|---:|---|---|---:|---:|---:|---|']
    for t in ('SPY', 'NVDA'):
        rows = raw_rows(t)
        spot = fx[t]['spot']
        live = sorted({str(r['expiry']) for r in rows if str(r['expiry']) >= '2026-10-29'})
        for scope, dates in (('today', {FRONT[t]}), ('all', set(live))):
            by = {}
            for r in rows:
                if str(r['expiry']) not in dates:
                    continue
                c = by.setdefault(num(r['strike']), [0.0, 0.0])
                c[0] += num(r['call_gamma_oi']); c[1] += num(r['put_gamma_oi'])
            ks = list(by)
            lv = gex.levels_of_rows(ks, [by[k][0] for k in ks], [by[k][1] for k in ks])
            g = GOLD[t][scope]
            L = priced_to_legs(fx[t]['scopes'][scope]['priced'])
            f = gex.repriced_flip(L, spot, r=0.042)
            d = abs(f['flip'] - g[1]) / spot if f['flip'] is not None else np.inf
            passed = (abs(lv['net'] - g[0]) <= 1e-9 * abs(g[0])) and [lv['callWall'], lv['putWall'], lv['supreme']] == list(g[2:]) and d <= 0.0002
            ok_all &= passed
            lines.append(f"| {t} | {scope} | {lv['net']:,.2f} | {g[0]:,.2f} | {lv['callWall']}/{lv['putWall']}/{lv['supreme']} | "
                         f"{g[2]}/{g[3]}/{g[4]} | {f['flip']:.4f} | {g[1]:.4f} | {d:.2e} | {'PASS' if passed else 'FAIL'} |")
            cases.append({'name': f'fixture {t} {scope}', 'spot': spot, 'r': 0.042, 'q': 0.0, 'legs': legs_json(L)})
            py.append((L, spot, 0.042))
    for s in range(40):
        spot, L = synthetic(1000 + s)
        cases.append({'name': f'synthetic {s}', 'spot': spot, 'r': 0.0 if s % 2 else 0.042, 'q': 0.0 if s % 3 else 0.013, 'legs': legs_json(L)})
        py.append((L, spot, cases[-1]['r'], cases[-1]['q']))
    hist = sorted(glob.glob(os.path.join(SCR, 'edgeg_hist_book_*.npz')))
    for f in hist:
        z = dict(np.load(f))
        L = gex.make_legs(**{k: z[k] for k in gex.FIELDS})
        spot = float(z['spot'])
        cases.append({'name': 'DEV ' + os.path.basename(f)[16:-4], 'spot': spot, 'r': 0.0, 'q': 0.0, 'legs': legs_json(L)})
        py.append((L, spot, 0.0, 0.0))
    for c, p in zip(cases, py):
        spot = c['spot']
        c['prices'] = list(np.linspace(spot * 0.9, spot * 1.1, 25))
        rng = np.random.default_rng(len(c['legs']))
        ks = sorted(set(round(x, 1) for x in rng.uniform(spot * 0.95, spot * 1.05, 30)))
        c['walls'] = [{'strike': k, 'c': float(rng.normal()), 'p': float(rng.normal())} for k in ks]
    inp, outp = os.path.join(SCR, 'parity_in.json'), os.path.join(SCR, 'parity_out.json')
    json.dump(cases, open(inp, 'w'))
    subprocess.run([TSX, os.path.join(HERE, 'ts_ref.ts'), inp, outp], cwd=SLAYER, check=True)
    ts = json.load(open(outp))
    lines += ['', '## (A) the same legs through gex.py and the app\'s TS (core/gammaFlip.ts, core/walls.ts)', '',
              '| case | legs | flip TS | flip py | rel | netAtSpot rel | crossings TS/py | max net rel (25 prices) | walls | pass |',
              '|---|---:|---:|---:|---:|---:|---|---:|---|---|']
    worst = 0.0
    fast_worst = 0.0
    npass = 0
    for c, p, o in zip(cases, py, ts):
        L, spot = p[0], p[1]
        r = p[2]
        q = p[3] if len(p) > 3 else 0.0
        f = gex.repriced_flip(L, spot, r=r, q=q)
        net = gex.net_gamma_path(L, spot, c['prices'], r, q)
        scale = max(1.0, float(np.max(np.abs(o['net']))) if o['net'] else 1.0)
        nrel = float(np.max(np.abs(net - np.array(o['net'])))) / scale
        frel = rel(f['flip'], o['flip'])
        arel = abs(f['netAtSpot'] - o['netAtSpot']) / max(1.0, abs(o['netAtSpot']), scale * 1e-3)
        cx_ok = len(f['crossings']) == len(o['crossings']) and all(abs(a - b) <= 1e-9 * max(1, abs(b)) for a, b in zip(f['crossings'], o['crossings']))
        w = gex.pick_leg_walls([x['strike'] for x in c['walls']], [x['c'] for x in c['walls']], [x['p'] for x in c['walls']])
        w_ok = w['callWall'] == o['walls']['callWall'] and w['putWall'] == o['walls']['putWall']
        ff = gex.repriced_flip(L, spot, r=r, q=q, fast=True)
        fast_d = 0.0 if (ff['flip'] is None and o['flip'] is None) else (abs(ff['flip'] - o['flip']) / spot if (ff['flip'] is not None and o['flip'] is not None) else 1.0)
        fast_worst = max(fast_worst, fast_d)
        passed = frel <= 1e-9 and arel <= 1e-9 and nrel <= 1e-9 and cx_ok and w_ok and fast_d <= 1e-7
        npass += passed
        ok_all &= passed
        worst = max(worst, frel if np.isfinite(frel) else 1.0, arel, nrel)
        fl = lambda v: 'none' if v is None else f'{v:.6f}'
        lines.append(f"| {c['name']} | {len(c['legs'])} | {fl(o['flip'])} | {fl(f['flip'])} | {frel:.1e} | {arel:.1e} | "
                     f"{len(o['crossings'])}/{len(f['crossings'])} | {nrel:.1e} | {'same' if w_ok else 'DIFF'} | {'PASS' if passed else 'FAIL'} |")
    lines += ['', f'**(A) {npass}/{len(cases)} cases pass; worst relative difference {worst:.2e}; fast mode (history) flip vs TS worst {fast_worst:.2e} of spot (bar 1e-7).**',
              f"**Overall: {'PASS' if ok_all else 'FAIL'}.**", '']
    open(os.path.join(HERE, 'PARITY.md'), 'w').write('\n'.join(lines) + '\n')
    print('\n'.join(lines[-3:]))
    sys.exit(0 if ok_all else 1)


if __name__ == '__main__':
    main()
