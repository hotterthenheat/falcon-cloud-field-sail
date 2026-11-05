"""Post-processing of k5_honest.py's saved calls: anti-signal, side-shuffle null, synthetic zero-drift null, CSCV PBO."""
import os, sys, json, numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rt
from k5_honest import GATES, summarize, synthetic_null, boot_ci
sys.path.insert(0, '/home/user/falcon-cloud-field-sail/.claude/worktrees/agent-a82a31a7b4c525883/slayer/research/compass-v2')
from eval.metrics import pbo_cscv  # noqa: E402

res = json.load(open('k5_honest_calls.json'))
cscv = json.load(open('k5_honest_cscv.json'))
days = sorted(res)

print('=== the three universes ===')
for g in GATES:
    print(summarize([cs[g] for cs in res.values()], f'gate={g}'))

print('\n=== anti-signal (the opposite side at the same mark; the shuffle null draws from the pair) ===')
for g in GATES:
    b2 = [dict(cs[g]['anti'], day=cs[g]['day']) for cs in res.values() if cs[g] and cs[g]['anti']]
    print(summarize(b2, f'anti-signal (gate={g})'))

print('\n=== side-shuffle null (1000 draws: each night keeps its mark/timing, the side is a coin flip) ===')
rng = np.random.default_rng(11)
for g in GATES:
    pairs = [(cs[g], cs[g]['anti']) for cs in res.values() if cs[g] and cs[g]['anti']]
    if len(pairs) < 5:
        print(f'gate={g}: too few paired nights ({len(pairs)})'); continue
    obs_w = np.mean([p[0]['win'] for p in pairs]); obs_r = np.mean([p[0]['ret'] for p in pairs])
    W = np.array([[p[0]['win'], p[1]['win']] for p in pairs], float); Rt = np.array([[p[0]['ret'], p[1]['ret']] for p in pairs])
    pick = rng.integers(0, 2, (1000, len(pairs)))
    ws = W[np.arange(len(pairs)), pick].mean(1); rs = Rt[np.arange(len(pairs)), pick].mean(1)
    print(f'gate={g} (n={len(pairs)} paired nights; observed win {100*obs_w:.1f}% ret {100*obs_r:+.1f}%): null win {100*ws.mean():.1f}% [5-95: {100*np.percentile(ws,5):.1f}, {100*np.percentile(ws,95):.1f}], '
          f'null ret {100*rs.mean():+.1f}% [{100*np.percentile(rs,5):+.1f}, {100*np.percentile(rs,95):+.1f}]; P(null win >= obs) {(ws >= obs_w).mean():.3f}; P(null ret >= obs) {(rs >= obs_r).mean():.3f}; '
          f'P(null win >= 0.881) {(ws >= 0.881).mean():.3f}')

print('\n=== both sides bought every night (unconditional base rate of the contract/exit structure, gate=none) ===')
both = [c for cs in res.values() if cs['none'] for c in (cs['none'], dict(cs['none']['anti'], day=cs['none']['day']) if cs['none']['anti'] else None) if c]
print(summarize(both, 'both sides'))

print('\n=== synthetic zero-drift null (GBM at the night\'s realised vol, BS bid/ask at the contract IV, spec exit, 300 paths a call) ===')
for g in GATES:
    cs = [c[g] for c in res.values() if c[g] and c[g].get('rv_night') is not None and np.isfinite(c[g]['rv_night'])]
    if not cs:
        continue
    pw, pr = zip(*[synthetic_null(c, c['rv_night']) for c in cs])
    pw = np.array(pw, float); pr = np.array(pr, float)
    ow = np.mean([c['win'] for c in cs]); orr = np.mean([c['ret'] for c in cs])
    # P(a zero-drift world gives >= observed win count): sum of independent Bernoullis with per-call p
    sims = (rng.random((2000, len(cs))) < pw[None, :]).mean(1)
    print(f'gate={g}: n={len(cs)}, observed win {100*ow:.1f}% ret {100*orr:+.1f}%; zero-drift expected win {100*np.nanmean(pw):.1f}% [per-call 5-95%: {100*np.nanpercentile(pw,5):.0f}-{100*np.nanpercentile(pw,95):.0f}], '
          f'expected ret {100*np.nanmean(pr):+.1f}%; P(zero-drift win rate >= observed) {(sims >= ow).mean():.4f}; median night rv {np.median([c["rv_night"] for c in cs]):.2f}')

print('\n=== CSCV PBO over the 27-configuration neighbourhood (delta band {0.05-0.15, 0.10-0.20, 0.15-0.25} x TP {1.4,1.5,1.6} x stop {0.45,0.4678,0.6}; per-session returns, 16 blocks) ===')
for g in GATES:
    keys = sorted(cscv[g])
    M = np.array([[cscv[g][k].get(d, 0.0) for k in keys] for d in days])
    if (M != 0).sum() == 0:
        print(f'gate={g}: no calls'); continue
    p = pbo_cscv(M, n_blocks=16, max_splits=5000)
    means = M.mean(0); frozen = keys.index('d15|tp1.5|sl0.4678')
    rank = int((means > means[frozen]).sum()) + 1
    ncalls = (M != 0).sum(0)
    print(f"gate={g}: PBO {p['pbo']:.3f} (splits {p['n_splits']}, logit median {p['logit_median']:+.2f}); frozen config mean/session {100*means[frozen]:+.2f}% ranks {rank}/27 "
          f"(calls {ncalls[frozen]}); neighbourhood mean/session min {100*means.min():+.2f}% max {100*means.max():+.2f}%; configs with mean>0: {(means > 0).sum()}/27")
    tbl = pd.DataFrame({'config': keys, 'mean_per_session_%': 100 * means, 'calls': ncalls, 'win_%': [100 * (M[:, i] > 0).sum() / max(ncalls[i], 1) for i in range(len(keys))]}).sort_values('mean_per_session_%', ascending=False)
    print(tbl.round(2).to_string(index=False))
