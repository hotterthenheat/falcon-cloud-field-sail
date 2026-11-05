"""Parity of EDGE's interim 1-second simulator against FOUNDATION's tick engine (worktree agent-a82a31a7b4c525883,
research/compass-v2/sim) on the sessions both have: the same contract, decision time and exit rule (stop 0.5 x fill,
the X2 trail, time stop), run through both; prints fills, exits and returns side by side.

  python3 port_check.py E1 DEV
"""
import json, os, sys
import numpy as np
import importlib.util
_sp = importlib.util.spec_from_file_location('edgesim', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'sim.py'))
edgesim = importlib.util.module_from_spec(_sp)
_sp.loader.exec_module(edgesim)
FOUND = '/home/user/falcon-cloud-field-sail/.claude/worktrees/agent-a82a31a7b4c525883/slayer/research/compass-v2'
sys.path.insert(0, FOUND)
from data.store import Session, list_sessions  # noqa: E402
from sim.engine import Engine, SimConfig, Strategy  # noqa: E402  (FOUNDATION's sim package shadows nothing of ours)
from sim.exits import AnyOf, FnExit, TimeStop  # noqa: E402


class Replay(Strategy):
    timer_ms = 1000

    def __init__(self, root, k, call, t_ms, t_end_ms, rules):
        self.root, self.k, self.call, self.t, self.t_end, self.rules = root, k, call, t_ms, t_end_ms, rules
        self.done = False

    def on_event(self, ctx, ev):
        if self.done or ctx.now < self.t:
            return
        self.done = True
        exps = ctx.expirations(self.root)
        if not exps or exps[0] != int(ctx.day):
            return
        cs = [c for c in ctx.contracts(self.root, 0) if abs(c.strike / (1000.0 if c.strike > 1e5 else 1.0) - self.k) < 1e-6 or abs(c.strike - self.k) < 1e-6]
        cs = [c for c in cs if (c.right == 1) == self.call]
        if not cs:
            return
        r = self.rules
        st = {'peak': 0.0, 'armed': False}

        def fn(ctx, pos):
            q = ctx.quote(pos.legs[0][0]) if hasattr(pos, 'legs') else None
            if q is None:
                return None
            b, fill = q.bid, pos.entry_px
            if b <= 0:
                return None
            if b <= r['stop'] * fill:
                return 'stop'
            if r.get('trail'):
                st['peak'] = max(st['peak'], b)
                if b >= r['trail_arm'] * fill:
                    st['armed'] = True
                if st['armed'] and b <= r['trail'] * st['peak']:
                    return 'trail'
            return None
        ctx.buy(cs[0], 1, exit=AnyOf(FnExit(fn), TimeStop(at=self.t_end)))


def main():
    H, which = sys.argv[1], sys.argv[2]
    have = json.load(open(os.path.join(edgesim.ROOT, 'results', f'{H}_{which}.json')))
    fs = set(list_sessions())
    for key, rec in sorted(have.items()):
        if not rec or rec['day'].replace('-', '') not in fs:
            continue
        s = rec['sides'].get('real')
        if not s or not s.get('res'):
            continue
        tr = rec['trig']
        for v, rules in (('z0.5-X1', {'stop': 0.5}), ('z0.5-X2', {'stop': 0.5, 'trail_arm': 1.25, 'trail': 0.75})):
            mine = s['res'].get(v)
            if not mine:
                continue
            S = Session(rec['day'].replace('-', ''))
            if rec['root'] not in S.roots:
                continue
            cfg = SimConfig(latency_ms=2000, flat_ms=int(tr['t_end'] * 1000) + 60000)
            out = Engine(S, Replay(rec['root'], s['sel']['k'], s['sel']['call'], int(tr['t'] * 1000), int(tr['t_end'] * 1000), rules), cfg).run()
            out = out.to_dict('records') if hasattr(out, 'to_dict') else out
            if not out:
                print(key, v, 'FOUNDATION: no trade', mine['fill'], mine['ret'])
                continue
            o = out[0]
            print(f"{key} {v}: EDGE fill {mine['fill']:.2f} exit {mine['exit']:.2f} ({mine['why']}) ret {100 * mine['ret']:+.1f}% | "
                  f"FOUNDATION fill {o.get('entry_px', o.get('entry_price'))} exit {o.get('exit_px', o.get('exit_price'))} ({o.get('reason')}) ret {100 * o.get('ret_gross', np.nan):+.1f}%")


if __name__ == '__main__':
    main()
