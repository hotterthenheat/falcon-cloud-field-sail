"""Is the 'Market Lyapunov' exponent of 1-minute returns any different from the same returns shuffled?

  python3 scripts/lyap_surrogate.py SPY

Takes 600 random 240-minute windows, computes Rosenstein's exponent on the real order and on a random
permutation of the same returns (which destroys any dynamics but keeps the distribution).
"""
import sys
import numpy as np
from lib import load_bars, returns, lyapunov_rosenstein, save_json

sym = sys.argv[1] if len(sys.argv) > 1 else 'SPY'
days, O, H, L, C, V = load_bars(sym)
r = returns(O, C)
flat = r[np.isfinite(r)]
rng = np.random.default_rng(11)
starts = rng.integers(0, len(flat) - 240, 600)
real = np.array([lyapunov_rosenstein(flat[s:s + 240]) for s in starts])
shuf = np.array([lyapunov_rosenstein(rng.permutation(flat[s:s + 240])) for s in starts])
d = real - shuf
boot = rng.choice(d, (2000, len(d))).mean(1)
out = dict(sym=sym, windows=600, real_mean=float(real.mean()), shuffled_mean=float(shuf.mean()),
           diff_mean=float(d.mean()), diff_ci=[float(np.percentile(boot, 2.5)), float(np.percentile(boot, 97.5))],
           share_real_above_shuffled=float((d > 0).mean()))
print(out)
save_json(f'lyap_surrogate_{sym}.json', out)
