"""R3's input on a study day: rho = 0DTE ATM IV (board 09:35, trading clock) / (30-day vol index at 09:35 / 100)."""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import brunner as R  # noqa: E402

D = sys.argv[1]
for root in sys.argv[2].split(','):
    d = R.study_day(D, root)
    s0, v = d.s(575), d.volix.get(575)
    print(root, 'x', d.x, 'sig0935', round(s0, 4), R.VOLIX.get(root), v, 'rho', round(s0 / (v / 100), 3) if v else None)
