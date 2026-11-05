"""Tiny markdown helpers (no tabulate on this machine)."""
from __future__ import annotations

import math

import pandas as pd


def _cell(v, floatfmt):
    if isinstance(v, float):
        return '' if math.isnan(v) else format(v, floatfmt)
    return str(v).replace('|', '/')


def md_table(df: pd.DataFrame, floatfmt: str = '.3f') -> str:
    cols = list(df.columns)
    out = ['| ' + ' | '.join(map(str, cols)) + ' |', '|' + '---|' * len(cols)]
    for row in df.itertuples(index=False):
        out.append('| ' + ' | '.join(_cell(v, floatfmt) for v in row) + ' |')
    return '\n'.join(out)
