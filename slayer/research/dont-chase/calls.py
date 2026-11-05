"""Model 1 (Hit score, Book A) calls with their outcome and the "don't chase" inputs at the mark.

Source: the challenger's built sessions (read-only), research/challenger/data/rows/*.calls.json, the engine's own
Book A calls (the late path over the bulk cache; `sim_check.py` showed the seats equal the engine's). Outcome by the
owner's definition, the hard exit: fill = the ask of the first minute quote at or after mark + 1 minute (within 3);
win = the bid reaches 1.50x that ask before it falls to 0.4678x (STOP_KEEP = 1 - 0.5322); otherwise flat at the
call's flat (15:55, or five minutes before an early close) at the bid. The minute path comes from the bulk chain
cache; every minute whose bid range crosses the stop or the target is then read in 1-second quotes (fetch1s.py) and
the exit judged on them (settle in analyze.py).

Inputs at the mark (only bars begun before the mark's minute, the engine's barsBefore rule): the underlying's
regular-session open (the 09:30 bar's open), its price (the close of the last bar before the mark), the day's high
and low so far. move = side-signed return since the open (calls +, puts -); pos = where the price sits in the day's
range on the call's side (1 = at the high for a call, at the low for a put).

    python3 -I calls.py      ->  data/calls.jsonl
"""
import gzip, json, glob, os, sys, datetime
from zoneinfo import ZoneInfo

CH = '/home/user/falcon-cloud-field-sail/.claude/worktrees/agent-a3673bb87994bc8be/slayer/research/challenger/data'
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'data')
NY = ZoneInfo('America/New_York')
UNDER = {'SPXW': 'SPX', 'NDXP': 'NDX', 'RUTW': 'RUT'}
STOP_KEEP = 1 - 0.5322
TP = 1.5

_bars = {}
def bars_month(name, ym):
    k = (name, ym)
    if k not in _bars:
        f = os.path.join(CH, 'bars', name, f'{ym}.csv.gz')
        by = {}
        if os.path.exists(f):
            for line in gzip.open(f, 'rt'):
                p = line.strip().split(',')
                if len(p) < 5: continue
                d, hm = p[0].split(' ')
                by.setdefault(d, []).append((int(hm[:2]) * 60 + int(hm[3:5]), float(p[1]), float(p[2]), float(p[3]), float(p[4])))
        _bars[k] = by
    return _bars[k]

def ny_ms(day, minute):
    y, m, d = map(int, day.split('-'))
    return int(datetime.datetime(y, m, d, minute // 60, minute % 60, tzinfo=NY).timestamp() * 1000)

def ny_min(ms):
    t = datetime.datetime.fromtimestamp(ms / 1000, NY)
    return t.hour * 60 + t.minute, t.strftime('%Y-%m-%d')

def tape_at(name, day, mark_min):
    rows = [b for b in bars_month(name, day[:7]).get(day, []) if 570 <= b[0] < mark_min]  # regular bars begun before the mark
    if not rows or rows[0][0] != 570: return None
    op = rows[0][1]
    hi = max(b[2] for b in rows); lo = min(b[3] for b in rows)
    return {'open': op, 'S': rows[-1][4], 'H': hi, 'L': lo, 'nbars': len(rows)}

def day_close_tape(name, day):
    rows = [b for b in bars_month(name, day[:7]).get(day, []) if 570 <= b[0] < 960]
    if not rows: return None
    return {'open': rows[0][1], 'close': rows[-1][4], 'H': max(b[2] for b in rows), 'L': min(b[3] for b in rows)}

_chain = {}
def contract_path(day, root, expiry, strike, right):
    f = os.path.join(CH, 'raw', day.replace('-', ''), f"{root}_{expiry.replace('-', '')}.csv.gz")
    if f not in _chain:
        by = {}
        if os.path.exists(f):
            for line in gzip.open(f, 'rt'):
                p = line.strip().split(',')
                if len(p) < 5: continue
                try:
                    k = (float(p[1]), p[2]); by.setdefault(k, []).append((p[0], float(p[3]), float(p[4])))
                except ValueError:
                    continue
        _chain.clear(); _chain[f] = by
    rows = _chain[f].get((float(strike), right), [])
    out = []
    for key, bid, ask in rows:
        if key[:10] != day: continue
        mn = int(key[11:13]) * 60 + int(key[14:16])
        out.append((ny_ms(day, mn), bid, ask))
    out.sort()
    return out

def settle_minutes(fired, flat, path):
    """settleHard on the minute path: returns (fill index, fill ask, exit, windows that cross a level)."""
    due = (fired // 60000) * 60000 + 60000
    at = next((i for i, q in enumerate(path) if q[0] >= due), None)
    if at is None or path[at][0] > fired + 180000: return None
    t0, b0, a0 = path[at]
    if not (a0 > 0 and b0 >= 0 and a0 >= b0): return None
    paid = a0; stop = paid * STOP_KEEP; tgt = round(paid * TP + 0.0049999, 2)  # A10: the target rounded up to the cent
    windows = []
    prev = path[at]
    exitq = None
    for q in path[at + 1:]:
        t, b, a = q
        if not (a > 0 and b >= 0 and a >= b): continue
        lo, hi = min(prev[1], b), max(prev[1], b)
        if q[0] < flat and any(lo <= L <= hi for L in (stop, tgt)): windows.append((prev[0], t))
        if t >= flat: exitq = (t, b, 'Flat'); break
        if b <= stop: exitq = (t, b, 'Stop'); break
        if b >= tgt: exitq = (t, tgt, 'TP'); break
        prev = q
    if exitq is None and path: exitq = (prev[0], prev[1], 'Last')
    return {'fillAt': t0, 'paid': paid, 'stop': stop, 'tgt': tgt, 'exit': exitq, 'windows': windows}

def main():
    os.makedirs(OUT, exist_ok=True)
    out = open(os.path.join(OUT, 'calls.jsonl'), 'w')
    n = miss_tape = miss_path = 0
    for f in sorted(glob.glob(os.path.join(CH, 'rows', '*.calls.json'))):
        d = json.load(open(f))
        day = d['day']
        for c in d['calls']:
            if c.get('book') != 'A': continue
            n += 1
            mark_min, mday = ny_min(c['mark'])
            name = UNDER.get(c['ticker'], c['ticker'])
            tape = tape_at(name, day, mark_min)
            dc = day_close_tape(name, day)
            path = contract_path(day, c['ticker'], c['expiry'], c['strike'], c['right'])
            st = settle_minutes(c['firedAt'], c['flatAt'], path) if path else None
            if tape is None: miss_tape += 1
            if st is None: miss_path += 1
            sgn = 1 if c['right'] == 'C' else -1
            rec = {'day': day, 'ticker': c['ticker'], 'contract': c['contract'], 'right': c['right'], 'strike': c['strike'],
                   'expiry': c['expiry'], 'sleeve': c['sleeve'], 'mark': c['mark'], 'markMin': mark_min, 'firedAt': c['firedAt'],
                   'flatAt': c['flatAt'], 'p1': c.get('p1'), 'spot': c.get('spot'), 'under': name}
            if tape:
                S, op, H, L = tape['S'], tape['open'], tape['H'], tape['L']
                rec['move'] = sgn * (S / op - 1)
                rng = H - L
                rec['pos'] = None if rng <= 0 else ((S - L) / rng if sgn > 0 else (H - S) / rng)
            if dc:
                rec['dayRet'] = dc['close'] / dc['open'] - 1
            if st:
                rec['settle'] = st
            out.write(json.dumps(rec) + '\n')
    out.close()
    print(f'{n} Book A calls; no tape at the mark {miss_tape}; no minute path/fill {miss_path}')

if __name__ == '__main__':
    main()
