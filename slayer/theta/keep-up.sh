#!/bin/sh
# One watcher. If the terminal is answering, leave it. If it dies, start it again.
set -u
ROOT=/workspace/slayer
JAVA="$ROOT/theta/jdk/bin/java"
JAR="$ROOT/theta/lib/202610141.jar"
LOG="$ROOT/theta/terminal.log"
KEY=$(grep -m1 '^THETADATA_API_KEY=' "$ROOT/.env" | cut -d= -f2-)
export JAVA_HOME="$ROOT/theta/jdk"
export PATH="$JAVA_HOME/bin:$PATH"

mkdir -p /tmp
exec 9>/tmp/theta-keep.lock
flock -n 9 || exit 0

while true; do
  if curl -sf -o /dev/null --max-time 3 "http://127.0.0.1:25503/v3/index/snapshot/price?symbol=SPX&format=json"; then
    sleep 15
    continue
  fi
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) terminal down, starting" >>"$LOG"
  "$JAVA" -jar "$JAR" --api-key "$KEY" >>"$LOG" 2>&1 || true
  sleep 5
done
