"""DataFrame -> markdown table (pandas.to_markdown needs tabulate, which is not installed here)."""
from __future__ import annotations

import pandas as pd


def md(df: pd.DataFrame, index: bool = True) -> str:
    d = df.reset_index() if index else df
    cols = [str(c) for c in d.columns]
    out = ['| ' + ' | '.join(cols) + ' |', '|' + '---|' * len(cols)]
    for row in d.itertuples(index=False):
        out.append('| ' + ' | '.join('' if (isinstance(v, float) and v != v) else str(v) for v in row) + ' |')
    return '\n'.join(out)
