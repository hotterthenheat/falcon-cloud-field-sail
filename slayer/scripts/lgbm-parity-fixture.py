# Regenerates scripts/fixtures/lgbm-parity.json with the real LightGBM.
# Run: python -I scripts/lgbm-parity-fixture.py . scripts/fixtures/lgbm-parity.json (needs lightgbm and numpy)
#      python -I scripts/lgbm-parity-fixture.py . scripts/fixtures/lgbm-parity-v2.json v2   (feature version 2's trees)
import json, re, sys, numpy as np, lightgbm as lgb
root = sys.argv[1]
tag = sys.argv[3] if len(sys.argv) > 3 else 'all6months'
entry = lgb.Booster(model_file=f'{root}/public/models/model_entry_{tag}.txt')
runner = lgb.Booster(model_file=f'{root}/public/models/model_runner_{tag}.txt')
txt = open(f'{root}/public/models/model_entry_{tag}.txt').read()
infos = re.search(r'^feature_infos=(.*)$', txt, re.M).group(1).split()
ranges = []
for s in infos:
    if s == 'none': ranges.append((0.0, 0.0)); continue
    a, b = s.strip('[]').split(':'); ranges.append((float(a), float(b)))
rng = np.random.default_rng(20261029)
n = 56; rows = []
for i in range(180):
    x = np.empty(n)
    for j, (a, b) in enumerate(ranges):
        lo, hi = a - 0.1 * (b - a), b + 0.1 * (b - a)
        x[j] = rng.uniform(lo, hi)
    if i % 3 == 0:
        x[rng.random(n) < 0.15] = np.nan
    if i % 7 == 0:
        x[rng.random(n) < 0.2] = 0.0
    if i % 11 == 0:
        x[rng.random(n) < 0.1] = 1e30
    rows.append(x.astype(np.float32).astype(np.float64))
rows.append(np.full(n, np.nan)); rows.append(np.zeros(n)); rows.append(np.full(n, 1e30)); rows.append(np.full(n, -1e30))
X = np.vstack(rows)
pe = entry.predict(X); pr = runner.predict(X)
def enc(v): return None if np.isnan(v) else float(str(np.float32(v)))  # shortest float32 text; the reader applies Math.fround
out = {
  'source': 'LightGBM %s Booster.predict on public/models/*_%s.txt; inputs are float32 (apply Math.fround), null is NaN' % (lgb.__version__, tag),
  'vectors': [[enc(v) for v in r] for r in X],
  'entry': [float(v) for v in pe], 'runner': [float(v) for v in pr]}
s = json.dumps(out, separators=(',', ':'))
open(sys.argv[2], 'w').write(s)
print(len(s), pe.min(), pe.max(), pr.min(), pr.max())
