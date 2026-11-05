"""
Nov 4 research: the rule variants tried on the development sessions only (Nov 2-4), before freezing RULES in study.py.
Every line printed here is one test in the overfitting count (LOG.md).

  python3 -I research/nov4/variants.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import study as S

B = S._band
V = {
    'R1a ch_flow>=0.2': lambda d: (d.sleeve == 'odte') & B(d) & (d.ch_flow >= 0.2) & (d.c_aggr15 > 0) & d.m.between(15, 240),
    'R1b ch_flow>=0.1 & volrate>=1': lambda d: (d.sleeve == 'odte') & B(d) & (d.ch_flow >= 0.1) & (d.c_aggr15 > 0) & (d.c_volrate >= 1) & d.m.between(15, 240),
    'R1c ch_flow>=0.1 & flip>0': lambda d: (d.sleeve == 'odte') & B(d) & (d.ch_flow >= 0.1) & (d.c_aggr15 > 0) & (d.flip > 0) & d.m.between(15, 240),
    'R1d ch_flow>=0.1 band .15-.35': lambda d: (d.sleeve == 'odte') & B(d, 0.15, 0.35) & (d.ch_flow >= 0.1) & (d.c_aggr15 > 0) & d.m.between(15, 240),
    'R2a weekly rv_iv>=1.5 flow>0': lambda d: (d.sleeve == 'weekly') & B(d) & (d.rv_iv >= 1.5) & (d.ch_flow > 0) & d.m.between(15, 90),
    'R2b weekly rv_iv>=1.2 flow>=0.1': lambda d: (d.sleeve == 'weekly') & B(d) & (d.rv_iv >= 1.2) & (d.ch_flow >= 0.1) & d.m.between(15, 90),
    'R4a reversal s_open<=-0.3%': lambda d: (d.sleeve == 'odte') & B(d) & (d.s_open <= -0.003) & (d.s_r5 > 0) & d.m.between(15, 60),
    'R4b reversal + ch_flow>0': lambda d: (d.sleeve == 'odte') & B(d) & (d.s_open <= -0.005) & (d.s_r5 > 0) & (d.ch_flow > 0) & d.m.between(15, 60),
}

if __name__ == '__main__':
    df = S.load(S.DEV)
    for k, f in V.items():
        c = S.calls_of(df, dict(mask=f, target=0.30))
        print(S.summarize(c, k), '|', ' '.join(f'{d[5:]}:{g.win.mean():.0%}/{len(g)}' for d, g in c.groupby('day')))
