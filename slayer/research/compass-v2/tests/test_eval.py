"""Sanity of the evaluation statistics on cases with known answers."""
import numpy as np
import pandas as pd

from eval.metrics import cluster_ci_mean, deflated_sharpe, max_drawdown, passes_bar, pbo_cscv, summarize
from data.splits import split_of


def test_pbo_is_about_half_for_pure_noise_and_low_for_a_real_edge():
    rng = np.random.default_rng(0)
    noise = rng.normal(0, 1, (160, 30))
    assert 0.3 < pbo_cscv(noise, n_blocks=10)['pbo'] < 0.8
    edge = noise.copy()
    edge[:, 0] += 0.6          # one configuration really is better, everywhere
    assert pbo_cscv(edge, n_blocks=10)['pbo'] < 0.1


def test_deflated_sharpe_penalises_many_trials():
    one = deflated_sharpe(0.25, 200, 1)['dsr']
    many = deflated_sharpe(0.25, 200, 500)['dsr']
    assert one > 0.99 and many < one


def test_cluster_ci_widens_with_correlated_sessions():
    rng = np.random.default_rng(1)
    ses = np.repeat(np.arange(20), 10)
    v = rng.normal(0, 1, 20)[ses] + rng.normal(0, 0.1, 200)   # all the noise is per session
    lo, hi = cluster_ci_mean(v, ses)
    naive = 1.96 * v.std() / np.sqrt(200)
    assert (hi - lo) / 2 > 2 * naive


def test_drawdown():
    assert max_drawdown([1, -2, -1, 3, -4]) == -4


def test_bar_needs_everything():
    rng = np.random.default_rng(2)
    tr = pd.DataFrame({'session': np.repeat([f'2024{i:04d}' for i in range(60)], 4), 'ret_net': rng.normal(0.2, 0.5, 240),
                       'ret_gross': 0.0, 'pnl_net': 1.0, 'pnl_gross': 1.0, 'entry_ms': 0, 'hold_s': 60})
    rep = summarize(tr, n_trials=1)
    bar = passes_bar(rep)
    assert bar['expectancy_ci_above_0'] and bar['n_ge_150']
    tr.loc[:, 'ret_net'] = rng.normal(0.0, 0.5, 240)
    assert not passes_bar(summarize(tr, n_trials=1))['pass']


def test_splits_are_the_protocol_ones():
    assert split_of('20240417') == 'DEV' and split_of('20220615') == 'LOCKED' and split_of('20240805') == 'LOCKED'
    assert split_of('20220815') == 'LOCKED' and split_of('20250203') == 'LOCKED' and split_of('20250603') == 'VALIDATION'
    assert split_of('20261103') == 'LOCKED' and split_of('20260302') == 'UNASSIGNED' and split_of('20241218') == 'DEV'
