"""1-second quotes for every minute window (calls.py) whose bid range crosses a call's stop or target.

The request is the shadow's own (compassChallenger hardPath): /option/history/quote ... interval=1s, from the minute
before + 1 s through the minute. Answered first from the challenger's cache1s (read-only, same key rule), then from
the terminal (127.0.0.1:25503, two in flight at most), kept under $DC_CACHE (the session scratchpad by default).

    python3 -I fetch1s.py
"""
import json, os, re, sys, time, datetime, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
CH1S = '/home/user/falcon-cloud-field-sail/.claude/worktrees/agent-a3673bb87994bc8be/slayer/research/challenger/data/cache1s'
MINE = os.environ.get('DC_CACHE', '/tmp/claude-0/-home-user/f71fb141-33a0-5344-9573-1a2ad4706812/scratchpad/dc1s')
BASE = 'http://127.0.0.1:25503/v3'
NY = ZoneInfo('America/New_York')

def clock(ms):
    t = datetime.datetime.fromtimestamp(ms / 1000, NY); return t.strftime('%H:%M:%S'), t.strftime('%Y%m%d')

def js_num(x):
    x = float(x); return str(int(x)) if x == int(x) else repr(x)

def req_path(c, after, through):
    to, d = clock(through)
    fr, d0 = clock(after + 1000)
    if d0 != d: fr = '00:00:00'
    return (f"/option/history/quote?symbol={c['ticker']}&expiration={c['expiry'].replace('-', '')}&strike={js_num(c['strike'])}"
            f"&right={'call' if c['right'] == 'C' else 'put'}&start_date={d}&end_date={d}&interval=1s&start_time={fr}&end_time={to}&format=json")

def key_of(p):
    return re.sub(r'[^A-Za-z0-9]+', '_', p)[:200]

def cached(p):
    k = key_of(p) + '.json'
    for d in (CH1S, MINE):
        f = os.path.join(d, k)
        if os.path.exists(f):
            try: return json.load(open(f))
            except Exception: pass
    return None

def get(p):
    for i in range(40):
        try:
            with urllib.request.urlopen(BASE + p, timeout=120) as r:
                body = r.read().decode()
                if 'No data found' in body[:200]: return {'status': 472, 'body': ''}
                return {'status': r.status, 'body': body}
        except urllib.error.HTTPError as e:
            if e.code == 472: return {'status': 472, 'body': ''}
            if e.code in (429, 500, 502, 503, 504): time.sleep(3 + i); continue
            return {'status': e.code, 'body': ''}
        except Exception:
            time.sleep(5)
    return {'status': 599, 'body': ''}

def fetch(p):
    got = get(p)
    if got['status'] in (200, 472):
        os.makedirs(MINE, exist_ok=True)
        tmp = os.path.join(MINE, key_of(p) + '.tmp')
        json.dump(got, open(tmp, 'w')); os.replace(tmp, os.path.join(MINE, key_of(p) + '.json'))
    return got['status']

def main():
    calls = [json.loads(l) for l in open(os.path.join(HERE, 'data', 'calls.jsonl'))]
    need = []
    have = 0
    for c in calls:
        st = c.get('settle')
        if not st: continue
        for a, b in st['windows'][-12:]:
            p = req_path(c, a, b)
            if cached(p) is None: need.append(p)
            else: have += 1
    need = sorted(set(need))
    print(f'windows cached {have}, to read {len(need)}', flush=True)
    done = 0; bad = 0
    with ThreadPoolExecutor(2) as ex:
        for s in ex.map(fetch, need):
            done += 1; bad += s not in (200, 472)
            if done % 100 == 0: print(f'{done}/{len(need)} read, {bad} not answered', flush=True)
    print(f'done: {done} read, {bad} not answered')

if __name__ == '__main__':
    main()
