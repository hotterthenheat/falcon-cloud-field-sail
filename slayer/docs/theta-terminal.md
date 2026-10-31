# The ThetaData terminal

ThetaData is the real-time source for quotes, chains, greeks and history on Terrain, Weigher, Compass and Practice
(Pinpoint and Dossier read Unusual Whales only). The data comes from ThetaData's own terminal, a Java program, and
**the account allows one terminal at a time**: a second one anywhere ends the first one's session.

Today the app is hosted on your PC and the terminal runs there too. When the site is hosted elsewhere (Vercel), it
cannot reach a terminal on a PC, so there is one always-on terminal with the relay (`theta/relay.mjs`) beside it and
everything goes through it: the hosted site (its `/api/theta` forwards to the relay) and any dev machine (set the
same two variables and it forwards there too, instead of starting a terminal of its own).

```
browser -> /api/theta (Vercel or your dev server) -> relay (THETA_RELAY_URL, secret) -> terminal 127.0.0.1:25503
```

## Today: the terminal on your PC

The app is hosted locally for now, so the terminal runs on the same PC as the dev server and nothing else should
ever run one with this account.

1. Put `THETADATA_API_KEY=td1_...` in `slayer/.env.local` (git-ignored).
2. **Keep it running 24/7** (Windows): from the `slayer` folder run
   `powershell -ExecutionPolicy Bypass -File theta\install-autostart.ps1` once (it needs Node 22 or 24 on the PATH,
   and says so if not). It registers two tasks: `SlayerTheta` (the supervised terminal, `npm run theta`) and
   `SlayerSite` (the built site with the Unusual Whales and ThetaData proxies, the shared data hub, the Compass engine
   and the exposure recorder, `npm run serve` on http://localhost:8080).
   - They start at every log-in; run the installer from an **Administrator** PowerShell and they also start at boot,
     before anyone logs in.
   - Each runs `theta\autostart-run.ps1`, which starts its program again 10 s after **any** exit, clean or not.
     Task Scheduler's own restart (every minute, up to 255 times, the most its schema allows) only backs that up:
     on its own it restarts a task only when it fails, never after a clean exit.
   - The installer runs `npm ci` if there is no `node_modules`, builds the site, and adds `THETA_AUTOSTART=0` to
     `slayer/.env.local` so nothing starts a second terminal.
   - Logs: `theta\run\autostart-theta.log`, `theta\run\autostart-site.log`, and the terminal's own
     `theta\run\terminal.out`.
3. **Keep the PC awake**: Settings → System → Power → put the device to sleep: Never (when plugged in).
4. **Check it**: `npm run theta:check` asks the terminal for every kind of data the pages read, twice each, and
   prints status, rows and the cold and warm time. A line naming "another ThetaData terminal" means a second terminal
   took the session: close it.

### Updating

```powershell
git pull
npm ci            # when package-lock.json changed (harmless otherwise)
npm run build
Stop-ScheduledTask SlayerSite;  Start-ScheduledTask SlayerSite
Stop-ScheduledTask SlayerTheta; Start-ScheduledTask SlayerTheta    # only when theta/ changed
```

SlayerSite also checks on every start: it rebuilds when the code changed since the last build (git's record of the
last pull or checkout) and runs `npm ci` first when `package-lock.json` changed, so `git pull` and a restart of the
task is enough. A new terminal jar goes into `theta\lib\` (the newest `.jar` there wins); restart SlayerTheta.

Start the terminal through `npm run theta` or `npm run dev`, not by double-clicking the jar: only a supervised
terminal is restarted when it stops, and the warmer keeps any running terminal hot.

## Later: the always-on terminal for a hosted site

Any always-on Linux machine with Java 21, Node 22 and about 2 GB of free memory: a small cloud server (2 vCPU / 4 GB
is comfortable), or a home machine that never sleeps.

1. **Install** Java 21 and Node 22, and copy the `slayer/` folder (or clone the repo) to `/opt/slayer`.
   Put the terminal jar at `slayer/theta/lib/<build>.jar` or `slayer/theta/ThetaTerminalv3.jar` (see One-time setup).
2. **Secrets** in `/etc/theta-relay.env` (readable by root and the service user only):
   ```
   THETADATA_API_KEY=td1_...
   THETA_RELAY_SECRET=<a long random string: openssl rand -hex 32>
   ```
3. **Run it as a service**: copy `slayer/theta/theta-relay.service` to `/etc/systemd/system/`, then
   `sudo systemctl daemon-reload && sudo systemctl enable --now theta-relay`. systemd restarts the relay if it ever
   exits; the relay's supervisor restarts the terminal if it exits, stops answering, or loses its session.
4. **Reach it over HTTPS.** The relay listens on port 25510 (`THETA_RELAY_PORT`). Put it behind TLS, for example
   a Cloudflare Tunnel (`cloudflared tunnel --url http://127.0.0.1:25510`, or a named tunnel on your domain) or Caddy
   with a domain. Never expose the terminal's own port 25503: it has no authentication.
5. **Point the site at it.** In Vercel → Project → Settings → Environment Variables (Production and Preview):
   `THETA_RELAY_URL=https://<your relay host>` and `THETA_RELAY_SECRET=<the same secret>`. Redeploy.
6. **Point your own dev server at it** the same way (`slayer/.env.local`: the same two lines). With
   `THETA_RELAY_URL` set the dev server never starts a local terminal, so it can't take the session.
7. **Check it**: `curl https://<relay host>/health` shows `"terminal":"up"`, the call counts and the cache size.

What keeps it up and fast:

- **Supervisor**: restarts the terminal if it exits (5 s, doubling to 5 minutes), if it stops answering for about
  45 s, or if its session has been lost for a minute (it logs in again; if that keeps happening, another terminal is
  using the account and the log says so).
- **Warmer**: every 15 s the relay asks the terminal for SPY, QQQ, IWM, SPX, NDX, RUT and VIX (`THETA_WARM` to
  change the list), so the market-data connection and the JVM never go cold; every 4 minutes it reloads the
  calendar and those names' expirations, so the first page view never waits on them.
- **Speed**: the terminal's 8 request slots are shared with snapshots ahead of history (history never takes more
  than 6), identical requests in flight become one, closed days are kept for hours and snapshots only for the
  400 ms burst window, and answers travel gzipped.

## One-time setup

1. **Install Java 21** (any OpenJDK 21 build, for example Eclipse Temurin 21 from https://adoptium.net).
   Check with `java -version`. If `java` on the PATH is another version, set `THETA_JAVA` to the full path of the
   Java 21 executable (Windows: `C:\Program Files\Eclipse Adoptium\jdk-21...\bin\java.exe`), or set `JAVA_HOME`.
2. **Download the terminal.** It must be the **v3** terminal: the app calls its v3 REST API (`/v3/...` on port
   25503); the older v1/v2 terminals answer other paths and do not work. Sign in at https://www.thetadata.net,
   download the v3 terminal (`ThetaTerminalv3.jar`, see https://docs.thetadata.us for the current link), and put it at
   `slayer/theta/ThetaTerminalv3.jar`. If ThetaData ships the newer `lib/<build>.jar` layout, put that jar in
   `slayer/theta/lib/`: the newest `*.jar` there wins over the bootstrap jar. Anywhere else works too with
   `THETA_JAR=<full path to the jar>`. All of these paths are git-ignored.
3. **Give it the key.** The API key is on your account page at https://www.thetadata.net (it starts `td1_`). Put
   `THETADATA_API_KEY=td1_...` in `slayer/.env.local` (git-ignored), or set it in the shell
   environment. Accounts that log in with email and password can instead create `slayer/theta/creds.txt` (email on
   line 1, password on line 2; git-ignored). The key is handed to the Java process through its environment, never on
   its command line, so it does not show up in `ps` or Task Manager's command-line column. The Java process gets only
   the variables Java needs (PATH, the system and temp folders, `JAVA_HOME`/`JAVA_TOOL_OPTIONS`, a proxy) and its own
   key: never the Unusual Whales, Supabase or relay secrets.

## How it starts

- `npm run dev` starts the supervisor (`theta/supervisor.mjs`) inside the dev server. Set `THETA_AUTOSTART=0` to
  turn that off.
- Or run it on its own, in a second terminal: `npm run theta` (Ctrl+C stops it and the terminal it started).

Both work the same on Windows, macOS and Linux; nothing needs `sh`. On Windows, use PowerShell or the VS Code
terminal from the `slayer` folder:

```powershell
cd slayer
$env:THETA_JAVA = "C:\Program Files\Eclipse Adoptium\jdk-21.0.5.11-hotspot\bin\java.exe"   # only if java is not 21
npm run theta
```

(PowerShell sets a variable with `$env:NAME = "value"`; the `NAME=value command` form is for macOS/Linux shells.)

What the supervisor does:

- One supervisor per checkout (`theta/run/supervisor.pid`); a second one exits at once. The file's time is refreshed
  every 15 s, so after a crash a PID that Windows has given to another program never blocks the next start.
- If something already answers on `127.0.0.1:25503` (a terminal you started by hand), it is left alone. A terminal
  that an earlier supervisor of this checkout started and left running (the supervisor was killed hard, for example
  by Task Manager) is adopted: watched like its own, and replaced if it stops answering.
- **A refused key** (the terminal prints "Invalid credentials" to `theta/run/terminal.out`): it logs one line,
  `ThetaData login failed: check THETADATA_API_KEY`, stops the terminal and does not try that key again for 10
  minutes (then 20, 40, up to an hour); a changed key in `.env.local` is tried at once. Pages read `terminal_login`
  from `/api/theta` meanwhile, not "not running".
- What it knows (starting, up, down, session_lost, unauthenticated, login_failed) is in `theta/run/state.json`,
  refreshed every 15 s; the data proxy reads it.
- It starts the jar with `theta/config.toml`, which binds the REST port (25503), the websocket port (25520) and the
  MCP endpoint to `127.0.0.1` only, and writes logs to `theta/run/logs/` and `theta/run/terminal.out`.
- If its terminal exits it is restarted after 5 s, then 10 s, doubling to at most 5 minutes; if its terminal stops
  answering for about 45 s it is stopped (by its own PID only) and restarted.
- With no jar, or no key and no `creds.txt`, it logs one line and does nothing.

`THETA_REST_BASE` (default `http://127.0.0.1:25503`) moves the URL the proxy calls; `THETA_CONFIG` points the
supervisor at another config file. Keep the two in step.

## Notes

- **One terminal per account.** ThetaData allows one terminal per account at a time, on any machine. A second one
  started anywhere (another PC, a laptop, the jar double-clicked, `npm run dev` while SlayerTheta runs) ends the first
  one's session ("Invalid session ID. This can occur if more than one terminal is running"), and restarting both makes
  them take turns throwing each other off. Stop the extra one; the supervised one reconnects by itself. A machine
  that needs ThetaData while another runs the terminal uses the relay (`THETA_RELAY_URL`), never a terminal of its
  own.
- The old `keep-up.sh` and the bundled `theta/jdk/` are gone. The JDK in git was broken (its `lib/modules` was a
  Git LFS pointer), and the script put the key on the command line and killed processes by name.
- The SPX book Terrain reads is built by `theta/build_spx_book.py` against a running terminal and written to
  `public/books/spx.json`.
