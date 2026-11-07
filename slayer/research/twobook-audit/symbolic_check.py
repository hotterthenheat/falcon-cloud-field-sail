"""Symbolic check: derive the ten Greeks with sympy from the §1.3 price and compare with the
§1.4 formulas (transcribed independently below in sympy) on 400 random points at 50 digits.

Derivative definitions (spec §1.4 / §7 Test 3):
  delta=dP/dS  gamma=d2P/dS2  vega=dP/dsig  vanna=d2P/dS dsig  vomma=d2P/dsig2
  charm=-d2P/dS dT  color_T=+d3P/dS2 dT  speed=d3P/dS3  veta_T=+d2P/dsig dT  zomma=d3P/dS2 dsig
"""
import json
import random
import sys

import sympy as sp

S, K, sig, T, r, b = sp.symbols("S K sigma T r b", positive=True)
r, b = sp.symbols("r b", real=True)

Nf = lambda x: sp.erfc(-x / sp.sqrt(2)) / 2
pdf = lambda x: sp.exp(-x ** 2 / 2) / sp.sqrt(2 * sp.pi)
sqT = sp.sqrt(T)
d1 = (sp.log(S / K) + (b + sig ** 2 / 2) * T) / (sig * sqT)
d2 = d1 - sig * sqT
ec = sp.exp((b - r) * T)

price = {
    "C": S * ec * Nf(d1) - K * sp.exp(-r * T) * Nf(d2),
    "P": K * sp.exp(-r * T) * Nf(-d2) - S * ec * Nf(-d1),
}


def derived(P):
    return {
        "delta": sp.diff(P, S),
        "gamma": sp.diff(P, S, 2),
        "vega": sp.diff(P, sig),
        "vanna": sp.diff(P, S, sig),
        "vomma": sp.diff(P, sig, 2),
        "charm": -sp.diff(P, S, T),
        "color_T": sp.diff(P, S, 2, T),
        "speed": sp.diff(P, S, 3),
        "veta_T": sp.diff(P, sig, T),
        "zomma": sp.diff(P, S, 2, sig),
    }


def spec_formulas(right):
    ph = pdf(d1)
    dd1dT = b / (sig * sqT) - d2 / (2 * T)
    gamma = ec * ph / (S * sig * sqT)
    vega = S * ec * ph * sqT
    if right == "C":
        delta = ec * Nf(d1)
        charm = -ec * (ph * dd1dT + (b - r) * Nf(d1))
    else:
        delta = -ec * Nf(-d1)
        charm = -ec * (ph * dd1dT - (b - r) * Nf(-d1))
    return {
        "delta": delta,
        "gamma": gamma,
        "vega": vega,
        "vanna": -ec * ph * d2 / sig,
        "vomma": vega * d1 * d2 / sig,
        "charm": charm,
        "color_T": gamma * ((b - r) + (d1 * d2 - 1) / (2 * T) - b * d1 / (sig * sqT)),
        "speed": -gamma / S * (1 + d1 / (sig * sqT)),
        "veta_T": vega * ((b - r) + (1 + d1 * d2) / (2 * T) - b * d1 / (sig * sqT)),
        "zomma": gamma * (d1 * d2 - 1) / sig,
    }


def main(npts=400, seed=20261107):
    rng = random.Random(seed)
    syms = (S, K, sig, T, r, b)
    fns = {}
    for right in "CP":
        der, spec = derived(price[right]), spec_formulas(right)
        # exact symbolic difference first (sympy simplify on the difference); numeric check below
        fns[right] = {g: (sp.lambdify(syms, der[g], "mpmath"), sp.lambdify(syms, spec[g], "mpmath"))
                      for g in der}
    import mpmath as mp
    mp.mp.dps = 50
    worst_abs = {g: mp.mpf(0) for g in fns["C"]}
    worst_rel = {g: mp.mpf(0) for g in fns["C"]}
    for i in range(npts):
        Sv = mp.mpf(rng.choice([37.5, 100, 752.1, 7566.48])) * mp.mpf(rng.uniform(0.9, 1.1))
        pt = (Sv, Sv * mp.mpf(rng.uniform(0.6, 1.6)), mp.mpf(rng.uniform(0.05, 1.5)),
              mp.mpf(10) ** mp.mpf(rng.uniform(-4.5, 0.5)), mp.mpf(rng.uniform(-0.02, 0.08)),
              mp.mpf(rng.uniform(-0.05, 0.08)))
        for right in "CP":
            for g, (fd, fs) in fns[right].items():
                a, s_ = fd(*pt), fs(*pt)
                diff = abs(a - s_)
                worst_abs[g] = max(worst_abs[g], diff)
                if s_ != 0:
                    worst_rel[g] = max(worst_rel[g], diff / abs(s_))
    res = {"points": npts, "rights": ["C", "P"], "dps": 50,
           "worst_abs": {g: mp.nstr(v, 3) for g, v in worst_abs.items()},
           "worst_rel": {g: mp.nstr(v, 3) for g, v in worst_rel.items()},
           "worst_abs_overall": mp.nstr(max(worst_abs.values()), 3),
           "worst_rel_overall": mp.nstr(max(worst_rel.values()), 3)}
    print(json.dumps(res, indent=1))
    return res


def exact():
    """Try to prove derived - spec == 0 symbolically, per Greek and right."""
    out = {}
    for right in "CP":
        der, spec = derived(price[right]), spec_formulas(right)
        for g in der:
            d = sp.simplify(sp.expand(der[g] - spec[g]))
            out[f"{right}.{g}"] = str(d)
            print(right, g, d, flush=True)
    return out


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "exact":
        ex = exact()
        with open("results_symbolic_exact.json", "w") as f:
            json.dump(ex, f, indent=1)
        sys.exit(0)
    res = main(int(sys.argv[1]) if len(sys.argv) > 1 else 400)
    with open("results_symbolic.json", "w") as f:
        json.dump(res, f, indent=1)
