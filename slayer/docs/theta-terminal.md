# Running the ThetaData terminal locally

The `/api/theta` proxy (`server/thetaProxy.mjs`) forwards to ThetaData's own terminal, a Java program that must run
on the same machine as the dev server. The terminal is a vendor download: it is not in this repository, and it never
runs on Vercel (there `/api/theta` answers `503 terminal_unavailable`).

## One-time setup

1. **Install Java 21** (any OpenJDK 21 build, for example Eclipse Temurin 21 from https://adoptium.net).
   Check with `java -version`. If `java` on the PATH is another version, set `THETA_JAVA` to the full path of the
   Java 21 executable (Windows: `C:\Program Files\Eclipse Adoptium\jdk-21...\bin\java.exe`), or set `JAVA_HOME`.
2. **Download the terminal.** Sign in at https://www.thetadata.net, download the v3 terminal
   (`ThetaTerminalv3.jar`, see https://docs.thetadata.us for the current link), and put it at
   `slayer/theta/ThetaTerminalv3.jar`. If ThetaData ships the newer `lib/<build>.jar` layout, put that jar in
   `slayer/theta/lib/`: the newest `*.jar` there wins over the bootstrap jar. Anywhere else works too with
   `THETA_JAR=<full path to the jar>`. All of these paths are git-ignored.
3. **Give it the key.** Put `THETADATA_API_KEY=td1_...` in `slayer/.env.local` (git-ignored), or set it in the shell
   environment. Accounts that log in with email and password can instead create `slayer/theta/creds.txt` (email on
   line 1, password on line 2; git-ignored). The key is handed to the Java process through its environment, never on
   its command line, so it does not show up in `ps` or Task Manager's command-line column.

## Running it

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

What the supervisor does:

- One supervisor per checkout (`theta/run/supervisor.pid`); a second one exits at once.
- If something already answers on `127.0.0.1:25503` (a terminal you started by hand), it is left alone.
- It starts the jar with `theta/config.toml`, which binds the REST port (25503), the websocket port (25520) and the
  MCP endpoint to `127.0.0.1` only, and writes logs to `theta/run/logs/` and `theta/run/terminal.out`.
- If its terminal exits it is restarted after 5 s, then 10 s, doubling to at most 5 minutes; if its terminal stops
  answering for about 45 s it is stopped (by its own PID only) and restarted.
- With no jar, or no key and no `creds.txt`, it logs one line and does nothing.

`THETA_REST_BASE` (default `http://127.0.0.1:25503`) moves the URL the proxy calls; `THETA_CONFIG` points the
supervisor at another config file. Keep the two in step.

## Notes

- ThetaData allows one terminal per account at a time. A second one started anywhere ends the first one's session
  ("Invalid session ID. This can occur if more than one terminal is running"): stop the extra one and restart.
- The old `keep-up.sh` and the bundled `theta/jdk/` are gone. The JDK in git was broken (its `lib/modules` was a
  Git LFS pointer), and the script put the key on the command line and killed processes by name.
- The SPX book Terrain reads is built by `theta/build_spx_book.py` against a running terminal and written to
  `public/books/spx.json`.
