# OOS2 — LOCKED-2 block for the K5 blind second look

Read `PREREG.md` first (the registration, committed before any session was built: 7e7bf45). This file is the
operator's and the blind scorer's hand-off.

## What is here
- `PREREG.md`, `LOCKED2.json`, `make_locked2.py` — the frozen block (799 sessions, tier A/B) and how it was derived.
- `pipeline/{fetch.ts,build.ts,localHost.ts}` — the challenger's own pipeline, verbatim except: imports point at the
  challenger engine tree (`agent-a3673bb87994bc8be/slayer`, hashed in `ENGINE_MANIFEST.sha256`), `DATA` defaults to
  `/home/user/falcon-cloud-field-sail/v2data/oos2`, and `CHAL_DAYS` (an allow-list = `LOCKED2.json`) keeps the fetch
  inside the block.
- `run_pipeline.sh` — fetch (SPXW only, one request in flight) by priority block + one row builder; resumable.
- `keep_building.sh` — restarts the builder when its time box ends (stop: `touch v2data/oos2/STOP`).
- `housekeep.sh` / `pack_raw.py` / `convert_rows.py` — rows csv.gz → zstd parquet (as `common.load_day` would), built
  days' raw cache → `raw/<ymd>.tar.xz` (`_done.json` stays), 1.4 GB budget (oldest raw archives go first; the rows
  are the deliverable).

## Parity (done before any LOCKED-2 day, on the already-used DEV day 2022-03-15)
1. Same raw cache (SPY/QQQ/IWM/SPXW) → 7179 rows, all 109 kept columns identical to the challenger's file, same 4
   engine would-calls.
2. SPXW-only raw cache → the 3723 SPXW rows identical in every column K5 reads (c1, c14, c33, session, ticker,
   strike/expiry/right, bid/ask, fill, hit50, worstPre, flatBid, …) and in the gates; only `batch`/`job`/`order`
   (pass numbering, relative order of SPXW passes unchanged) and `c50` (`harSpy`, a SPY realised-vol feature filled
   only when SPY is scanned as a root; not read by K5) differ.

## Cache layout (`/home/user/falcon-cloud-field-sail/v2data/oos2`)
    rows/<day>.parquet       the built rows (all SPXW rows of the session: overnight/pre/regular, both sleeves)
    rows/<day>.calls.json    the engine's own would-calls (netless; the day counts as built when this exists)
    raw/<ymd>/_done.json     fetched marker; raw/<ymd>.tar.xz the packed chain/OI/board files of a built day
    bars/<sym>/<month>.csv.gz, meta/, logs/{driver,fetch,build,housekeep}.log

## Resume / stop
    cd <this worktree>/slayer
    setsid nohup bash research/compass-v2/oos2/run_pipeline.sh > /dev/null 2>&1 &      # resumes where it stopped
    setsid nohup bash research/compass-v2/oos2/keep_building.sh > /dev/null 2>&1 &
    setsid nohup bash research/compass-v2/oos2/housekeep.sh > /dev/null 2>&1 &
    touch /home/user/falcon-cloud-field-sail/v2data/oos2/STOP    # stops keep_building; kill run_pipeline.sh + tsx for the rest
Pace observed 2026-11-05 (terminal shared with three other workers): 170–210 s a session when the terminal answers,
much slower when it stalls; ~7 requests a session + 9 bar requests a month.

## Blind scorer
    export CHAL_DATA=/home/user/falcon-cloud-field-sail/v2data/oos2
    python3 - <<'EOF'
    import json; L = json.load(open('<this dir>/LOCKED2.json')); days = sorted(s['day'] for s in L['sessions'])
    EOF
- Use the first look's code (`agent-a537945bf25597d8c/slayer/research/compass-v2/blind/k5_locked.py`,
  `k5_locked_exec.py`, `chal_c45a7d2.py`): `chal_c45a7d2` imports the challenger's `common.py`, which honours
  `CHAL_DATA`, so `C.days_built()` lists this cache; replace `is_locked(d)` by `d in LOCKED2 days`, keep
  `roots=['SPXW'], session='overnight'`, write results under the scorer's own directory, and point the 1-s quote
  cache (`QDIR`) at `/home/user/falcon-cloud-field-sail/v2data/oos2/quotes1s`.
- Score what is built at that moment; report per tier (A/B), per period and regime label (PREREG §3), pooled with the
  first look (n = 59). Sessions in `LOCKED2.json` without `rows/<day>.calls.json` are reported as missing (PREREG §4.3).
- Nobody on the OOS2 side has run K5 or read an outcome column on these rows.
