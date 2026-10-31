# Slayer terminal

Options and flow terminal: Trace, Pinpoint, Dossier, Terrain, Weigher, Compass, Practice and Pulse.

- **Unusual Whales** powers Trace, Dossier, and Pinpoint's greeks, exposure, levels and flow.
- **ThetaData** powers the real-time quotes, chains, greeks, bars and history on Terrain, Weigher, Compass and
  Practice, and Pinpoint's live price and candles.

Which vendor feeds which box is in `docs/DATA_MAP.md`; the rules are in `docs/DATA_SOURCES.md` and
`docs/PAGE_CONTRACT.md`.

## Run it on your PC

You need:

- **Node 22 or 24** (https://nodejs.org, the LTS installer). Check with `node -v`.
- **Java 21** or newer (Eclipse Temurin 21 from https://adoptium.net). Check with `java -version`.
- **A ThetaData account and its API key** (`td1_...`, from your account page at https://www.thetadata.net), and
  **the v3 ThetaData terminal jar**, downloaded from thetadata.net: put it at `slayer/theta/lib/<build>.jar` (the
  newest `.jar` there wins) or `slayer/theta/ThetaTerminalv3.jar`. Older v1/v2 terminals do not work: the app calls the
  v3 REST API (`/v3/...` on port 25503). Details: `docs/theta-terminal.md`, "One-time setup".
- **An Unusual Whales API key.**

Every command below runs in PowerShell (or the VS Code terminal) **from the `slayer` folder**.

1. **Get the code** (the first time):
   ```powershell
   git clone https://github.com/hotterthenheat/falcon-cloud-field-sail.git
   cd falcon-cloud-field-sail
   git checkout main
   cd slayer
   npm ci
   ```
   Already cloned: `git checkout main`, `git pull`, then `cd slayer` and `npm ci`.
2. **Keys.** Create `slayer/.env.local` (it is git-ignored and never leaves your PC):
   ```
   UNUSUAL_WHALES_API_KEY=...
   THETADATA_API_KEY=td1_...
   ```
   **ThetaData allows one terminal per account, anywhere.** A second terminal started with the same key (another PC,
   a laptop, the jar double-clicked, `npm run dev` while the autostart task runs) ends the first one's session, and the
   two then keep throwing each other off. Run it in one place only: either let the app start it (step 3), or start it
   yourself with `npm run theta` / the autostart task (`docs/theta-terminal.md`) and add `THETA_AUTOSTART=0` to
   `.env.local` so the app never starts a second one.
3. **Start it:** `npm run dev`, then open **http://localhost:8080**. The dev server also starts and supervises the
   ThetaData terminal (restarts it if it stops, leaves it to reconnect if the session is taken, keeps it warm). If the
   key is wrong, the server log says `ThetaData login failed: check THETADATA_API_KEY` and it stops trying for a while.
4. **Check ThetaData:** with the terminal up, `npm run theta:check` asks it for every kind of data the pages use and
   prints status, rows, and cold and warm time for each.

Settings for one session go in PowerShell's syntax, before the command (`.env.local` is the place for ones you keep):

```powershell
$env:PORT = "9000"; npm run serve            # another port
$env:THETA_AUTOSTART = "0"; npm run dev      # do not start a terminal
Remove-Item Env:PORT                         # back to the default
```

(`PORT=9000 npm run serve` is the macOS/Linux spelling and does not work in PowerShell.)

### Updating

```powershell
git pull
npm ci
npm run build
```

then restart whatever runs the app: stop `npm run dev` with Ctrl+C and start it again, or, with the autostart tasks,
`Stop-ScheduledTask SlayerSite; Start-ScheduledTask SlayerSite` (and the same for `SlayerTheta` if `theta/` changed).
The SlayerSite task also rebuilds by itself on start when the code changed since its last build.

The first page view after a start takes a few seconds while the shared data hub fills; after that pages paint at
once, and a reload paints the last data this browser kept (stamped "as of …") while the fresh data loads.

**Compass runs inside the server**, not in the browser: `npm run dev` and `npm run serve` both start its scan, which
runs every mark from start to shutdown whether or not a page is open, and every browser shows the same record. The
record is `slayer/.cache/compass/YYYY-MM-DD.json`. Start the server before the session you want scanned; marks missed
while it was off or while ThetaData was down are scored afterwards from recorded quotes and marked "late". How it
works and what it needs: `docs/compass-engine.md`.

**Terrain's exposure field is recorded inside the server too.** The vendor keeps no per-strike history for today, so a
browser alone could only draw the field from the moment it opened. `npm run dev` and `npm run serve` read the per-strike
exposure of the house's names and of every name a Terrain viewer opened today (25 at most) once a minute from 09:30 ET
(every two minutes in the premarket and after hours), into `slayer/.cache/exposure/YYYY-MM-DD/`, and Terrain merges that
record with its own reads, so a viewer arriving at 14:00 sees the day from the open. It shares the Unusual Whales hub
and never gets ahead of a viewer. `EXPOSURE_RECORDER=0` turns it off. Budget and settings: `docs/exposure-recorder.md`.

## Keep it running 24/7 on your PC

From the `slayer` folder, once: `powershell -ExecutionPolicy Bypass -File theta\install-autostart.ps1` (from an
Administrator PowerShell they also start at boot, before anyone logs in). It registers two Windows tasks that start at
every log-in and start their program again within seconds whenever it exits: **SlayerTheta** (the ThetaData
terminal) and **SlayerSite** (the built site, the data proxies, the Compass engine and the exposure recorder on
http://localhost:8080), so Compass scans and Terrain's field is recorded every session. Keep
the PC from sleeping. Don't also run `npm run dev` while SlayerSite runs. Details: `docs/theta-terminal.md`.

## Serve it to other people

For more than a few viewers, run the production build instead of the dev server:

```powershell
npm run build
npm run serve          # http://localhost:8080; $env:PORT = "9000" first to change it
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
npx tsx scripts/exposure-recorder-proof.ts
```

CI (`.github/workflows/ci.yml`) runs the typecheck, the build, every proof script and every golden test on each push.
