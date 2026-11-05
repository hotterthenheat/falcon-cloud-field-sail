"""The source guard catches every way around the context API that we know of."""
from sim.lint import check_source

GOOD = '''
from data.store import Contract
from sim.engine import Strategy
from sim.exits import VolBracket
import numpy as np

class S(Strategy):
    def __init__(self):
        self._n = 0
    def on_event(self, ctx, ev):
        self._n += 1
        q = ctx.quote(Contract('SPY', 20240417, 500000, 1))
'''

BAD = {
    'store': 'from data.store import Session\n',
    'pyarrow': 'import pyarrow.parquet as pq\n',
    'mangled': 'def f(ctx):\n    return ctx._StrategyContext__e.session\n',
    'open': 'x = open("/home/user/falcon-cloud-field-sail/v2data/x")\n',
    'getattr': 'def f(ctx):\n    return getattr(ctx, "_StrategyContext__e")\n',
    'dict': 'def f(ctx):\n    return ctx.__dict__\n',
    'net': 'import urllib.request\n',
    'closure': 'def f(ctx):\n    return ctx.quote.__closure__\n',
}


def test_lint_accepts_a_normal_strategy():
    assert check_source(GOOD) == []


def test_lint_refuses_every_peek_route():
    for name, src in BAD.items():
        assert check_source(src), name
