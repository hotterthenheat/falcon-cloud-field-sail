import math

import numpy as np

R = 0.05


def _ncdf(x):
    # Abramowitz-Stegun 7.1.26 erf (abs error < 1.5e-7), vectorised
    z = np.asarray(x, float) / math.sqrt(2)
    s = np.sign(z); a = np.abs(z)
    t = 1 / (1 + 0.3275911 * a)
    y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * np.exp(-a * a)
    return 0.5 * (1 + s * y)


def price(S, K, tau, iv, call):
    S, K, tau, iv = map(lambda a: np.asarray(a, float), (S, K, tau, iv))
    tau = np.maximum(tau, 1e-6)
    sd = iv * np.sqrt(tau)
    d1 = (np.log(S / K) + (R + 0.5 * iv * iv) * tau) / sd
    d2 = d1 - sd
    if call:
        return S * _ncdf(d1) - K * np.exp(-R * tau) * _ncdf(d2)
    return K * np.exp(-R * tau) * _ncdf(-d2) - S * _ncdf(-d1)


def delta(S, K, tau, iv, call):
    tau = max(tau, 1e-6)
    d1 = (math.log(S / K) + (R + 0.5 * iv * iv) * tau) / (iv * math.sqrt(tau))
    n = 0.5 * (1 + math.erf(d1 / math.sqrt(2)))
    return n if call else n - 1


def implied_vol(P, S, K, tau, call):
    lo, hi = 1e-3, 6.0
    intrinsic = max(0.0, S - K * math.exp(-R * tau)) if call else max(0.0, K * math.exp(-R * tau) - S)
    if P <= intrinsic + 1e-6:
        return float('nan')
    for _ in range(60):
        mid = 0.5 * (lo + hi)
        if float(price(S, K, tau, mid, call)) > P:
            hi = mid
        else:
            lo = mid
    return 0.5 * (lo + hi)
