"""Tiny markdown table writer (no tabulate on this machine)."""


def md(df, floatfmt='{:.4g}'):
    cols = list(df.columns)
    out = ['| ' + ' | '.join(str(c) for c in cols) + ' |', '|' + '|'.join('---' for _ in cols) + '|']
    for _, r in df.iterrows():
        cells = []
        for c in cols:
            v = r[c]
            if isinstance(v, float):
                cells.append('' if v != v else floatfmt.format(v))
            else:
                cells.append(str(v))
        out.append('| ' + ' | '.join(cells) + ' |')
    return '\n'.join(out)
