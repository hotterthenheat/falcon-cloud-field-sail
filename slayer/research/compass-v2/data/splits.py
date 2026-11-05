"""The fixed V2 data splits (V2_PROTOCOL rule 6). Never edit these ranges.

DEV        = sessions before 2025-01-01, excluding H1/H2 days
VALIDATION = 2025-01-01 .. 2025-12-31, excluding H2 days
LOCKED     = H1 U H2 U every session from 2026-07-01
  H1 (deliverables/compass-model4/README.md, LOG.md): 2022-06-01..06-30, 2024-08-01..08-30, 2026-10-05..10-30
  H2: 2022-07-01..09-30, 2025-01-02..03-31
Sessions 2026-01-01..2026-06-30 are in no split (unassigned) — use them for nothing that is reported.
"""
from __future__ import annotations

H1 = [('20220601', '20220630'), ('20240801', '20240830'), ('20261005', '20261030')]
H2 = [('20220701', '20220930'), ('20250102', '20250331')]
LOCKED_FROM = '20260701'


def _in(d, ranges):
    return any(a <= d <= b for a, b in ranges)


def split_of(day: str) -> str:
    d = day.replace('-', '')
    if _in(d, H1) or _in(d, H2) or d >= LOCKED_FROM:
        return 'LOCKED'
    if d < '20250101':
        return 'DEV'
    if d <= '20251231':
        return 'VALIDATION'
    return 'UNASSIGNED'


def only(days, split: str) -> list[str]:
    return [d for d in days if split_of(d) == split]


def assert_split(days, split: str):
    bad = [d for d in days if split_of(d) != split]
    if bad:
        raise ValueError(f'{len(bad)} sessions are not {split}: {bad[:5]}')
