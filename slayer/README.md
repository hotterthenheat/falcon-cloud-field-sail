# Slayer terminal

Options and flow terminal: Trace, Pinpoint, Dossier, Terrain, Weigher, Compass, Practice and Pulse.

- **Unusual Whales** powers Trace, Dossier, and Pinpoint's greeks, exposure, levels and flow.
- **ThetaData** powers the real-time quotes, chains, greeks, bars and history on Terrain, Weigher, Compass and
  Practice, and Pinpoint's live price and candles.

Which vendor feeds which box is in `docs/DATA_MAP.md`; the rules are in `docs/DATA_SOURCES.md` and
`docs/PAGE_CONTRACT.md`.

## Run it on your PC

You need Node 22, Java 21 and the ThetaData terminal jar (see `docs/theta-terminal.md`, "One-time setup").

1. **Get the code** (PowerShell or the VS Code terminal):
   ```powershell
   git fetch origin
   git checkout claude/real-data-ui-lock     # or main, once the pull requests are merged
   git pull
   cd slayer
   npm ci
   ```
2. **Keys.** Create `slayer/.env.local` (it is git-ignored and never leaves your PC):
   ```
   UNUSUAL_WHALES_API_KEY=...
   THETADATA_API_KEY=td1_...
   ```
   ThetaData allows **one terminal per account**. Run it in one place only: either let the app start it (step 3), or
   start it yourself with `npm run theta` / the autostart task (`docs/theta-terminal.md`) and add
   `THETA_AUTOSTART=0` to `.env.local` so the app never starts a second one.
3. **Start it:** `npm run dev`, then open **http://localhost:8080**. The dev server also starts and supervises the
   ThetaData terminal (restarts it if it stops, logs back in if the session is taken, keeps it warm).
4. **Check ThetaData:** with the terminal up, `npm run theta:check` asks it for every kind of data the pages use and
   prints status, rows, and cold and warm time for each.

The first page view after a start takes a few seconds while the shared data hub fills; after that pages paint at
once, and a reload paints the last data this browser kept (stamped "as of …") while the fresh data loads.

**Compass runs inside the server**, not in the browser: `npm run dev` and `npm run serve` both start its scan, which
runs every mark from start to shutdown whether or not a page is open, and every browser shows the same record. The
record is `slayer/.cache/compass/YYYY-MM-DD.json`. Start the server before the session you want scanned; marks missed
while it was off or while ThetaData was down are scored afterwards from recorded quotes and marked "late". How it
works and what it needs: `docs/compass-engine.md`.

## Keep it running 24/7 on your PC

From the `slayer` folder, once: `powershell -ExecutionPolicy Bypass -File theta\install-autostart.ps1`. It registers
two Windows tasks that start at every log-in and restart within a minute if they stop: **SlayerTheta** (the ThetaData
terminal) and **SlayerSite** (the built site, the data proxies and the Compass engine on http://localhost:8080). Keep
the PC from sleeping. Don't also run `npm run dev` while SlayerSite runs. Details: `docs/theta-terminal.md`.

## Serve it to other people

For more than a few viewers, run the production build instead of the dev server:

```powershell
npm run build
npm run serve          # http://localhost:8080, or PORT=... to change it
```

`npm run serve` does not start ThetaData: run `npm run theta` (or the autostart task) alongside it. Every viewer is
served from one shared copy of each answer (`server/hub.mjs`), so five viewers or five hundred make the same vendor
calls. `npm run load:proof` (needs the server running, and once `npx playwright install chromium`) opens the same pages with 1 and 5 browsers and prints the
vendor calls each made.

Accounts (sign-in, plans) turn on when `SUPABASE_URL` and its keys are set; with them unset, the data proxies are
open on your machine, which is fine for local use. With accounts on and Stripe not yet live, set
`PROXY_PLAN_GATE=off` so signed-in users without a paid plan can still read data.

## Checks

```powershell
npm run typecheck
npm run build
npx tsx scripts/golden/pinpoint-golden.ts        # and the other scripts/golden/*-golden.ts
node scripts/hub-proof.mjs
```

CI (`.github/workflows/ci.yml`) runs the typecheck, the build, every proof script and every golden test on each push.
