"""Live input domain against the training domain.

The two LightGBM files carry each column's training range (feature_infos) and, per split, the missing-value rule
(decision_type bits 2-3: 0 none, 1 zero, 2 NaN). This reads both and a day of scored rows the engine logged
(.cache/compass/rows/YYYY-MM-DD.jsonl) and prints, per column, the training range, the live range, how many live
values fall outside it, the share of NaN, and how each model treats a NaN.

  python scripts/compass-domain.py .cache/compass/rows/2026-10-29.jsonl [more.jsonl ...]
"""

import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
MODELS = os.path.join(HERE, '..', 'public', 'models')


def model_info(path):
    text = open(path, encoding='utf-8').read()
    infos = re.search(r'^feature_infos=(.*)$', text, re.M).group(1).split()
    ranges = []
    for s in infos:
        if s == 'none':
            ranges.append(None)
            continue
        lo, hi = s.strip('[]').split(':')
        ranges.append((float(lo), float(hi)))
    missing = {}
    for block in text.split('\nTree=')[1:]:
        feats = [int(v) for v in re.search(r'^split_feature=(.*)$', block, re.M).group(1).split()]
        kinds = [int(v) for v in re.search(r'^decision_type=(.*)$', block, re.M).group(1).split()]
        for f, d in zip(feats, kinds):
            missing.setdefault(f, set()).add({0: 'none', 1: 'zero', 2: 'nan'}[(d >> 2) & 3])
    return ranges, missing


def unsafe(info):
    """Columns a NaN breaks: the model never saw one there (missing type none) and the 0 it is read as lies outside
    the training range, so the row walks a branch no training row took."""
    ranges, missing = info
    return sorted(c for c, kinds in missing.items() if 'none' in kinds and ranges[c] and not (ranges[c][0] <= 0 <= ranges[c][1]))


def main(argv):
    window = '--window' in argv
    paths = [a for a in argv if a != '--window']
    entry = model_info(os.path.join(MODELS, 'model_entry_all6months.txt'))
    runner = model_info(os.path.join(MODELS, 'model_runner_all6months.txt'))
    rows = []
    for p in paths:
        with open(p, encoding='utf-8') as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                row = json.loads(line)
                if window and not (15 <= (row['x'][0] or -1) <= 330):
                    continue
                rows.append(row)
    n = len(rows)
    print(f'rows {n}{" (t 15..330 only)" if window else ""}')
    print(f'NaN-unsafe columns: entry {unsafe(entry)}, runner {unsafe(runner)}')
    print('col | train range (entry; runner) | live range | below | above | NaN% | entry NaN rule | runner NaN rule')
    for c in range(56):
        vals = [r['x'][c] for r in rows]
        fin = [v for v in vals if v is not None]
        lo, hi = entry[0][c]
        rlo, rhi = runner[0][c]
        both = f'[{lo:.4g}, {hi:.4g}]' + ('' if (rlo, rhi) == (lo, hi) else f'; [{rlo:.4g}, {rhi:.4g}]')
        lo, hi = min(lo, rlo), max(hi, rhi)
        below = sum(1 for v in fin if v < lo)
        above = sum(1 for v in fin if v > hi)
        live = f'[{min(fin):.4g}, {max(fin):.4g}]' if fin else '[]'
        nan = 100 * (n - len(fin)) / n if n else 0
        flag = ' <-' if below or above or ('none' in runner[1].get(c, set()) and nan > 0) else ''
        print(f'{c:>3} | {both} | {live} | {below} | {above} | {nan:.1f} | '
              f'{",".join(sorted(entry[1].get(c, {"unused"})))} | {",".join(sorted(runner[1].get(c, {"unused"})))}{flag}')


if __name__ == '__main__':
    main(sys.argv[1:])
