"""EDGE-K run (specs/PREREG.md @ a0e1dc6).

  python3 ek.py xsp            fetch the XSP boards of every SPXW signal minute (one request in flight)
  python3 ek.py fit            per-set, per-fold parameters (no option outcome is read)
  python3 ek.py run [minutes]  pick + real outcomes per session (atomic v2data/edge-k/res/<day>.json; resumable)
  python3 ek.py run --nofetch  only what the caches hold
"""
import hashlib, json, os, sys, time
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import signals as SG  # noqa: E402
import model as M  # noqa: E402
import ek_data as D  # noqa: E402
import sim, ht  # noqa: E402

RES = os.path.join(SG.OUT, 'res')
PICKERS = ('Kf', 'Kr', 'A', 'B', 'C', 'D', 'R0', 'R1', 'R2', 'K0r', 'K0o')


def all_signals():
    return SG.s1_signals() + SG.s2_signals()


def seed_of(*a):
    return int(hashlib.md5('|'.join(map(str, a)).encode()).hexdigest()[:8], 16)


def fetch_xsp():
    n = 0
    for s in all_signals():
        if s['root'] != 'SPXW':
            continue
        D.xsp_board(s['day'], (s['t'] - 60) // 60)
        n += 1
        if n % 50 == 0:
            print(time.strftime('%H:%M:%S'), 'xsp boards', n, D.STATS, flush=True)
    print('xsp done', n, D.STATS)


_FIT = {}


def params(setname, day):
    if setname not in _FIT:
        _FIT[setname] = M.fit(setname, [s for s in all_signals() if s['set'] == setname])
    return _FIT[setname][str(M.fold(day))]


def attach(cands, par, root, scale):
    sp = par['spread'].get(root)
    if sp is None:
        return []
    for c in cands:
        c.update(beta=sp['beta'], hmin=sp['hmin'], scale=scale, K=c['k'])
    return cands


def choose(sig, today=None, board_fn=None, xsp_fn=None):
    """Every picker's contract for one signal (no outcome read). today/board_fn/xsp_fn: overrides for the look-ahead
    test (they must make no difference)."""
    setname, root, day, t, up, S = sig['set'], sig['root'], sig['day'], sig['t'], sig['up'], sig['S']
    und = M.UND[root]
    par = params(setname, day)
    prof = M.profile(und, day)
    out = {'sig': sig, 'picks': {}, 'er': {}, 'n_F': 0, 'n_mini': 0}
    if prof is None:
        out['why'] = 'no profile'
        return out
    feat = M.level_features(und, day, t, M.SET[setname]['flat_bar'], prof, causal=True, today=today)
    if feat is None:
        out['why'] = 'no features'
        return out
    bfn = board_fn or (lambda r, d, tt: sim.board(r, d, tt))
    brd = bfn(root, day, t)
    xb = None
    if root == 'SPXW':
        xb = xsp_fn(day, (t - 60) // 60) if xsp_fn else D.xsp_board(day, (t - 60) // 60, fetch=False)
    side = {}
    for nm, call in (('real', up), ('opp', not up)):
        Fr = attach(D.candidates(setname, root, day, t, call, S, brd), par, root, 1.0)
        Fm = attach(D.candidates(setname, 'XSP', day, t, call, S / 10.0, xb), par, 'XSP', 0.1) if xb is not None else []
        side[nm] = (Fr, Fm)
    Fr, Fm = side['real']
    out['n_F'], out['n_mini'] = len(Fr), len(Fm)
    # outermost stored strike on the side still two-sided? (board coverage diagnostic)
    if brd is not None and len(brd):
        bs = brd[brd.r == (1 if up else 0)].sort_values('k')
        edge = bs.iloc[-1] if up else bs.iloc[0]
        out['edge_two_sided'] = bool(edge.bid > 0 and edge.ask > edge.bid)
    seed = seed_of(setname, root, day)
    lS_k, decay, info = M.simulate_paths(setname, t, S, prof, feat, par, par['kappa'], up, seed)
    lS_0, _, _ = M.simulate_paths(setname, t, S, prof, feat, par, 0.0, up, seed)
    out['model'] = {'Lpoint': info['Lpoint'], 'sig_f': info['sig_f'], 'kappa': par['kappa'], 'lp': feat['lp'], 'lt': feat['lt']}
    allr = Fr + Fm
    if allr:
        erk = M.er_contracts(setname, lS_k, decay, allr)
        er0 = M.er_contracts(setname, lS_0, decay, allr)
        for c, a, b in zip(allr, erk, er0):
            c['er'], c['er0'] = a, b
    Fo = side['opp'][0] + side['opp'][1]
    if Fo:
        for c, b in zip(Fo, M.er_contracts(setname, lS_0, decay, Fo)):
            c['er0'] = b

    def slim(c, **kw):
        return {**{k: c[k] for k in ('root', 'k', 'call', 'bid', 'ask', 'iv', 'delta', 'h0', 'mid0', 'S', 'W') if k in c},
                **{k: c.get(k) for k in ('er', 'er0')}, **kw}
    P = out['picks']
    if allr:
        P['Kf'] = slim(max(allr, key=lambda c: c['er']))
    if Fr:
        P['Kr'] = slim(max(Fr, key=lambda c: c['er']))
        P['B'] = slim(min(Fr, key=lambda c: (abs(c['k'] - S), c['ask'])))
        P['C'] = slim(min(Fr, key=lambda c: (c['ask'], abs(c['k'] - S))))
        P['K0r'] = slim(max(allr, key=lambda c: c['er0']))
        rng = np.random.default_rng(seed + 1)
        idx = rng.choice(len(allr), min(3, len(allr)), replace=False)
        for j, i in enumerate(idx):
            P[f'R{j}'] = slim(allr[i])
        # D: Compass style, ITM 4..0 strikes from the ATM strike, bid > 0.15, spread <= 8%
        ks = D.board_strikes(root, day, t, brd)
        iatm = int(np.argmin(np.abs(ks - S)))
        byk = {c['k']: c for c in Fr}
        for n in (4, 3, 2, 1, 0):
            j = iatm - n if up else iatm + n
            if 0 <= j < len(ks) and ks[j] in byk:
                c = byk[ks[j]]
                if c['bid'] > 0.15 and (c['ask'] - c['bid']) <= 0.08 * c['mid0']:
                    P['D'] = slim(c, itm=n)
                    break
    if Fo:
        P['K0o'] = slim(max(Fo, key=lambda c: c['er0']))
    # A: the signal's registered 0.35-delta pick (its own gates), from the same board
    a = ht.select(root, day, t, up, 0.35, S) if setname == 'S1' else sim.select(root, day, t, up, 0.25, 0.50, 0.35, S)
    if a is not None:
        P['A'] = {'root': root, 'k': a['k'], 'call': a['call'], 'bid': a['bid0'], 'ask': a['ask0'], 'iv': a['iv'], 'delta': a['delta'],
                  'er': next((c['er'] for c in Fr if c['k'] == a['k']), None)}
    out['er_max'] = P['Kf']['er'] if 'Kf' in P else None
    out['er0_max_real'] = P['K0r']['er0'] if 'K0r' in P else None
    out['er0_max_opp'] = P['K0o']['er0'] if 'K0o' in P else None
    out['F_er'] = [[c['root'], c['k'], round(c['ask'], 2), round(c['delta'], 3), round(c['er'], 4)] for c in allr]
    return out


PICKS = os.path.join(SG.OUT, 'picks')


def session_order():
    by = {}
    for s in all_signals():
        by.setdefault(s['day'], []).append(s)
    days = sorted(by)
    rng = np.random.default_rng(20261105)
    return [days[i] for i in rng.permutation(len(days))], by


def pick_session(day):
    """CPU phase: every picker's contract for every signal of the session (no outcome, no terminal)."""
    f = os.path.join(PICKS, f'{day}.json')
    if os.path.exists(f):
        return day
    _, by = session_order()
    rec = [choose(sig) for sig in by[day]]
    tmp = f + '.tmp'
    json.dump(ht._clean(rec), open(tmp, 'w'))
    os.replace(tmp, f)
    return day


def pick_all(nproc=2):
    os.makedirs(PICKS, exist_ok=True)
    for s in ('S1', 'S2'):
        params(s, '2023-06-01')  # fit once before forking
    order, _ = session_order()
    todo = [d for d in order if not os.path.exists(os.path.join(PICKS, f'{d}.json'))]
    from multiprocessing import Pool
    t0 = time.time()
    with Pool(nproc) as pool:
        for i, d in enumerate(pool.imap(pick_session, todo)):
            if (i + 1) % 20 == 0:
                print(f'{time.strftime("%H:%M:%S")} picked {i + 1}/{len(todo)} ({time.time() - t0:.0f}s)', flush=True)
    open(os.path.join(PICKS, 'DONE'), 'w').write(time.strftime('%H:%M:%S'))
    print('picks done', flush=True)


MAIN = ('Kf', 'Kr', 'A', 'B', 'C', 'D')


def do_session(day, sigs, phase=1):
    """phase 1: fetch the compared pickers' outcomes (nulls' picks marked deferred unless already cached by a main
    pick); phase 2: fill the deferred ones in an existing result file. Fetch order never changes an outcome."""
    f = os.path.join(PICKS, f'{day}.json') if phase == 1 else os.path.join(RES, f'{day}.json')
    rec = json.load(open(f))
    for ch in rec:
        sig = ch['sig']
        cache = {}
        for name in sorted(ch['picks'], key=lambda n: n not in MAIN):
            p = ch['picks'][name]
            key = (p['root'], p['k'], p['call'])
            if phase == 2 and (p.get('out') or {}).get('skip') != 'deferred':
                cache.setdefault(key, p['out'])
                continue
            if key in cache:
                p['out'] = cache[key]
            elif phase == 1 and name not in MAIN:
                p['out'] = {'skip': 'deferred'}
            else:
                cache[key] = p['out'] = D.outcome(sig, *key)
    return rec


def run_phase2(max_minutes=1e9):
    order, _ = session_order()
    t0, n = time.time(), 0
    for day in order:
        f = os.path.join(RES, f'{day}.json')
        if not os.path.exists(f):
            continue
        rec = json.load(open(f))
        if not any((p.get('out') or {}).get('skip') == 'deferred' for r in rec for p in r['picks'].values()):
            continue
        if time.time() - t0 > max_minutes * 60:
            print('time cut', flush=True)
            break
        rec = do_session(day, None, phase=2)
        tmp = f + '.tmp'
        json.dump(ht._clean(rec), open(tmp, 'w'))
        os.replace(tmp, f)
        n += 1
        if n % 10 == 0:
            print(f'{time.strftime("%H:%M:%S")} phase2 sessions {n} fetch {D.STATS["fetch"]} ({D.STATS["fetch_s"]:.0f}s)', flush=True)
    print('phase2 done', D.STATS, flush=True)


def run(max_minutes=1e9):
    os.makedirs(RES, exist_ok=True)
    order, by = session_order()
    days = order
    t0, n = time.time(), 0
    for day in order:
        f = os.path.join(RES, f'{day}.json')
        if os.path.exists(f):
            continue
        while not os.path.exists(os.path.join(PICKS, f'{day}.json')):  # the CPU phase runs alongside, same order
            if os.path.exists(os.path.join(PICKS, 'DONE')):
                break
            time.sleep(5)
        if not os.path.exists(os.path.join(PICKS, f'{day}.json')):
            continue
        if time.time() - t0 > max_minutes * 60:
            print('time cut', flush=True)
            break
        rec = do_session(day, by[day])
        if D.NOFETCH and any(isinstance(p.get('out'), dict) and p['out'].get('skip') == 'missing'
                             for r in rec for p in r['picks'].values()):
            continue
        tmp = f + '.tmp'
        json.dump(ht._clean(rec), open(tmp, 'w'))
        os.replace(tmp, f)
        n += 1
        if n % 10 == 0:
            print(f'{time.strftime("%H:%M:%S")} sessions {len(os.listdir(RES))}/{len(days)} fetch {D.STATS["fetch"]} '
                  f'({D.STATS["fetch_s"]:.0f}s) disk {D.disk_free_gb():.2f} GB', flush=True)
    print('done', D.STATS, flush=True)


if __name__ == '__main__':
    cmd = sys.argv[1]
    D.NOFETCH = '--nofetch' in sys.argv
    if cmd == 'xsp':
        fetch_xsp()
    elif cmd == 'fit':
        for s in ('S1', 'S2'):
            p = params(s, '2023-06-01')
            fit = _FIT[s]
            for k in sorted(fit):
                x = fit[k]
                print(s, k, 'coef', np.round(x['coef'], 3), 'res_sd %.3f r2 %.3f n %d kappa %+.4f (n %d)' % (
                    x['res_sd'], x['r2'], x['n_level'], x['kappa'], x['n_kappa']),
                    {r: (round(v['beta'], 3), round(v['hmin'], 3)) for r, v in x['spread'].items()})
    elif cmd == 'pick':
        pick_all(int(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[2].isdigit() else 2)
    elif cmd in ('run', 'run2'):
        mm = [float(a) for a in sys.argv[2:] if a[0].isdigit()]
        (run if cmd == 'run' else run_phase2)(mm[0] if mm else 1e9)
