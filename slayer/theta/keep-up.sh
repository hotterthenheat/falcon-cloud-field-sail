#!/bin/sh
# One terminal. A dead session is not a reason to start a second jar.
set -u
ROOT=/workspace/slayer
JAVA="$ROOT/theta/jdk/bin/java"
JAR="$ROOT/theta/lib/202610141.jar"
LOG="$ROOT/theta/terminal.log"
KEY=$(grep -m1 '^THETADATA_API_KEY=' "$ROOT/.env" | cut -d= -f2- | tr -d '"' | tr -d "'")
export JAVA_HOME="$ROOT/theta/jdk"
export PATH="$JAVA_HOME/bin:$PATH"

mkdir -p /tmp
exec 9>/tmp/theta-keep.lock
flock -n 9 || exit 0

alive() {
  curl -sf -o /dev/null --max-time 8 "http://127.0.0.1:25503/v3/stock/snapshot/quote?symbol=SPY&format=json"
}

kill_terminal() {
  for p in /proc/[0-9]*; do
    cmd=$(tr '\0' ' ' < "$p/cmdline" 2>/dev/null || true)
    case "$cmd" in
      *202610141.jar*|*ThetaTerminal*)
        kill "$(basename "$p")" 2>/dev/null || true
        ;;
    esac
  done
}

while true; do
  if alive; then
    sleep 15
    continue
  fi
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) quote desk not answering, one restart" >>"$LOG"
  kill_terminal
  sleep 2
  kill_terminal
  sleep 1
  "$JAVA" -jar "$JAR" --api-key "$KEY" >>"$LOG" 2>&1 || true
  sleep 8
done
