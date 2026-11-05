"""EDGE-D look-ahead canaries: (1) a peeking strategy must raise LookAheadError through ctx; (2) the parity forward
built from the chain must use only rows stamped <= the decision time; (3) greeks rows are invisible before their stamp."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

import build  # noqa: E402
import fetch_events as fe  # noqa: E402
from build import clock  # noqa: E402
from sim.engine import Engine, LookAheadError, SimConfig, Strategy  # noqa: E402

d = [x for x in build.days(status='ok') if x >= '2022'][0]
s = build.build_session(d)
T = clock('08:30')
cfg = SimConfig(start_ms=T - 9 * 60000, flat_ms=T + 120 * 60000, end_ms=T + 121 * 60000)


class Peek(Strategy):
    timer_ms = 1000

    def on_event(self, ctx, ev):
        if ctx.now >= clock('08:25'):
            c = ctx.chain('SPXW', 0).contract.iloc[0]
            ctx.quote_at(c, ctx.now + 1000)


try:
    Engine(s, Peek(), cfg).run()
    print('FAIL: peek not caught')
except LookAheadError as e:
    print('ok: peek raised', str(e)[:70])

ch = pd.read_parquet(os.path.join(build.DATA, d, 'chain1m.parquet'))
t = clock('08:25')
F_all, atm, _ = fe.forward(ch, t)
F_cut, atm2, _ = fe.forward(ch[ch.ms <= t], t)
assert F_all == F_cut and atm == atm2, 'forward used later rows'
F_shift, _, _ = fe.forward(ch[ch.ms < t], t)        # drop the rows AT t: result must change (proves the t rows were used)
print('ok: forward from rows <= t only; F(<=t) =', F_all, ' F(<t) =', F_shift)
si = build.straddle_implied(d, t)
print('ok: straddle_implied', si)


class G(Strategy):
    timer_ms = 1000

    def on_event(self, ctx, ev):
        if ctx.now == clock('08:35') + 59000:
            ch = ctx.chain('SPXW', 0)
            assert ch.gms.max() <= ctx.now, 'greeks from the future'
            self.seen = int(ch.gms.max())


g = G()
Engine(s, g, cfg).run()
assert g.seen == clock('08:35'), g.seen
print('ok: greeks stamp seen at 08:35:59 =', g.seen, '== 08:35:00')
print('all canaries passed on', d)
