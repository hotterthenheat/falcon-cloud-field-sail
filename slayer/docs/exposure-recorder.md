# The exposure recorder

Terrain's exposure field (one row a strike, one column a bar) is built from Unusual Whales' per-strike exposure rows,
read through the day (`src/data/book/exposureLog.ts`). The vendor keeps no per-strike history for today: its per-strike
routes answer the latest book only, and a past `date=` only as of that day's close. A browser that opens Terrain at
14:00 could only draw from 14:00. The recorder reads the same rows on the server, all day, and every viewer's field
starts from the open.

## Where it runs

- Like the Compass engine (`docs/compass-engine.md`): **`npm run dev`**, **`vite preview`** and **`npm run serve`**
  (`server.ts`) start it when they start listening and stop it when they close. It reads whether or not anyone has
  Terrain open. The owner's PC **SlayerSite** task runs `npm run serve`, so it records every session.
- The code: `src/data/exposureRecorder.ts` (the schedule, the names, the record files, the HTTP answers) and
  `src/data/book/exposureSegs.ts` (how an answer becomes readings and how a reading joins a strike's series, one rule
  for the server and the browser). `server/exposureApi.mjs` mounts it.
- One process per record folder reads: it holds `.cache/exposure/recorder.lock` (refreshed every 30 s, stale after two
  minutes). A second server on the same folder serves the first one's record and reads nothing.
- On Vercel there is no long-lived process: the recorder does not run, `/api/exposure/*` is not there, and Terrain
  behaves as before (below).

## What it reads

The exact paths a Terrain viewer's field reads (`exposureLog.ts` `readCut`), so one cached answer serves both:

| Cut on Terrain | Path | Calls |
|---|---|---|
| Every expiry (the default) | `/stock/{t}/spot-exposures/strike?limit=500&page=N` | 1 a name (a page holds 500 strikes; SPY's whole book is 491), up to 4 |
| Today (the front expiry) | `/stock/{t}/spot-exposures/expiry-strike?expirations[]={front}&limit=500` | 1 a name |
| (finding the front expiry) | `/stock/{t}/greek-exposure/expiry` | 1 a name a day |

The front expiry is the first listed date whose 16:00 ET close is still ahead (after the bell, the next one). A later
expiry the reader picks on Terrain is not recorded; that cut fills from the page's own reads, as before.

**When:** on trading days (`core/calendar.ts`), every minute **09:30–16:15 ET**, and every two minutes in the
**premarket (04:00–09:30)** and **after hours (16:15–20:00)**, the sessions Terrain draws (`data/deskSession.ts`).
Readings two minutes apart still join (the field joins readings up to three minutes apart, `JOIN_MS`). An answer the
vendor has not recalculated since the last read is not written again.

**Which names:** the house's (`HOUSE_NAMES`: SPY, QQQ, AAPL, NVDA, SPX, IWM, TSLA, MSFT, AMZN, META — Terrain's
opening desk first), then every name a Terrain viewer opened today, latest first, up to the cap (25). A viewer's
field asking `/api/exposure/day` for today is what names it (kept in `.cache/exposure/YYYY-MM-DD/names.json`). A
name the vendor refuses or answers empty two passes running is left out for the day.

**How it asks:** through the in-process hub (`server/uwProxy.mjs` `uwDirect(path, { lane: 'record' })`), so it shares
the cache and the key's three slots with every viewer:

- one ask at a time, so it never holds more than **one** of the three slots;
- a vendor call it needs goes in **its own** background lane (`record`), beside the hub's refresh lane (the popular
  paths and keep-warm): each holds one slot at most, both wait while any viewer is queued, and together they never
  take the slot a quick ask needs. Before 2026-10-31 the recorder shared the one refresh slot, which spent 35–70 s
  of every minute on refreshes, and passes ran out of time;
- a copy of the answer younger than 45 s (a viewer's own read of the same path) is reused, not asked again;
- its asks are not counted as a viewer's, so the hub keeps nothing warm on its schedule;
- the book for every name goes first, then the front expiries: when time runs short it is the second cut that waits;
- a pass stops 50 s after it started, and the names it did not reach go first next time;
- a 429, a vendor fault or a timeout stops the pass and backs off 1, 2, 4, then 8 minutes. While the key's 429
  breaker holds (`server/uwProxy.mjs`) a recorder ask gives up at once instead of waiting, so the pass stops early
  rather than queueing behind it.

## The budget

The key allows **3 concurrent requests** across everyone; the rate-limit header reads 1,000,000 requests a minute
(`docs/wall-backtest.md`), so what binds is slot time, not the count. With the default 25 names, both cuts:

| Window | Asks | Per minute |
|---|---|---|
| 09:30–16:15 (405 passes) | 20,250 | **50** (0.83 a second), 75 on the day's first pass (the expiry lists) |
| 04:00–09:30 and 16:15–20:00 (277 passes, every 2 min) | 13,875 | 25 on average |
| The day | 34,125 | |

These are the most it asks: each ask is a vendor call only when no viewer read the same path in the last 45 s, so
every name a viewer has open costs the recorder nothing on that cut. One slot of the three, one ask at a time: at the
hub's usual 0.3–0.6 s for these routes, a minute's 50 asks hold one slot for 15–30 s, and never while a viewer waits.
`scripts/exposure-recorder-proof.ts` counts them minute by minute over a whole day.

If a pass cannot finish inside its 50 s (`/api/exposure/status` shows `last.missed`, and `missedTotal` /
`passesMissing` since start; the log says so once and then every tenth such pass), record less:
`EXPOSURE_FRONT=0` records the whole book only (25 a minute), `EXPOSURE_NAMES_MAX=10` records ten names (20 a minute),
`EXPOSURE_EXT_EVERY=0` reads the regular session only.

## The record

`.cache/exposure/YYYY-MM-DD/<TICKER>.jsonl` (git-ignored), one line an answer (one page of one cut), only the rows the
field keeps (strikes within 5% of the row's price):

```
{"at":1793295532793,"n":1793295534100,"c":"ALL","p":0,"r":[[770,0,-445796038.47,563243939.95],…]}
```

`at` is the moment the answer is for (its newest row `time`), `n` when it was read, `c` the cut (`ALL` for the whole
book, else the expiry), `p` the page, and each row `[strike, ms from the row's recalculation to at, open-interest gamma,
today's flow gamma]` in the dealer sign, as `exposureLog.ts` keeps them. A finished day is gzipped (`.jsonl.gz`, about
a quarter of the size); days older than ten are removed (`EXPOSURE_KEEP_DAYS`). SPY, the largest, writes a few
megabytes a day before gzip; most names far less.

## The API (read-only)

- `GET /api/exposure/day?ticker=T&day=YYYY-MM-DD[&since=ms]`: the name's series for the day in the shape the browser's
  log keeps (`series: [[cut, strike, [from, to, oi, flow, …]]]`), with `recording`, `startedAt`, `firstAt` and `lastAt`
  (the recorder's first and last read of the name that day) and `readings`. With `since`, only the segments that end
  after it. Asking for today names the ticker as opened by a viewer.
- `GET /api/exposure/status`: whether it records (and why not), the names, the cap, the last pass (asks, vendor calls,
  lines, missed, fault), the vendor calls of the last ten passes, and `missedTotal` / `passesMissing`: the cuts
  passes did not reach since start, and how many passes missed any.

The gate is the Unusual Whales proxy's (`server/auth.mjs`): open on local work, a signed-in plan when accounts are on.

## In the browser

When a Terrain field opens (`useFieldPoll`), `exposureLog.ts` asks `/api/exposure/day` for today (and, before the open
or on a day the market is shut, the session before, once) and merges the series into its own log, then keeps reading
the cut itself every minute; it asks the server again every five minutes for only what changed (`since`). The two
join without seams: they are the same segments, and where both hold a minute they agree. The field's key says where
the day starts:

- the server recorded from the open: "read since 09:30 ET";
- the server started late (after 09:32 ET): "recorded from 11:42 ET", and nothing is drawn before it;
- no recorder (Vercel, an older server, or `EXPOSURE_RECORDER=0` with nothing on file): "read since 14:02 ET · this
  page's first read", the field as before.

## Settings

| Variable | Default | |
|---|---|---|
| `EXPOSURE_RECORDER` | on | `0` serves the record without reading |
| `EXPOSURE_DIR` | `.cache/exposure` | the record folder |
| `EXPOSURE_NAMES` | the house's | a comma list in place of `HOUSE_NAMES` |
| `EXPOSURE_NAMES_MAX` | 25 | names recorded at most, the house's first |
| `EXPOSURE_KEEP_DAYS` | 10 | days kept |
| `EXPOSURE_FRONT` | on | `0` records the whole book only |
| `EXPOSURE_EXT_EVERY` | 2 | minutes between reads in the premarket and after hours; `0` reads 09:30–16:15 only |

## Proof

`npx tsx scripts/exposure-recorder-proof.ts` (CI runs it) drives the recorder on a pinned clock against a counting
stand-in for Unusual Whales: the reading windows, holidays and weekends, the names and the cap, one pass and a whole
day's calls, the 50 s deadline and the rotation after it, the 429 backoff, the folder lock (a second process, a dead
holder, a stale lock), pruning and gzip, the HTTP answers, a merge with a page's own live log that draws every cell the
same as reading the whole day in the page, and the hub's record lane through the real proxy with the vendor's fetch
stood in (three requests at most, one for the recorder, viewers ahead of it, a viewer's copy reused).
`scripts/golden/terrain-golden.ts` checks the merge on the recorded session polls by the hand values.
