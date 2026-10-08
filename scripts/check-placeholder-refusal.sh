#!/usr/bin/env bash
# Proves a production server refuses to start on the demo seed: it must
# exit with an error, never serve a page, and name each placeholder
# (the localhost address, the demo exchange rates, the demo accounts).
# Needs a production build and a freshly seeded database.
set -uo pipefail
PORT="${PORT:-3999}"
LOG="$(mktemp)"
env -u ALLOW_PLACEHOLDERS NODE_ENV=production PORT="$PORT" timeout 90 npx next start -p "$PORT" > "$LOG" 2>&1
code=$?
cat "$LOG"
fail() { echo "FAIL: $1"; exit 1; }
[ "$code" -eq 124 ] && fail "the server kept running instead of refusing to start"
[ "$code" -eq 0 ] && fail "the server exited cleanly instead of refusing to start"
grep -q "Refusing to start in production" "$LOG" || fail "no refusal message"
grep -q "APP_URL is http://localhost" "$LOG" || fail "the localhost address not named"
grep -Eq "exchange rates? (is a demo value|are demo values)" "$LOG" || fail "demo exchange rates not named"
grep -q "Demo accounts exist" "$LOG" || fail "demo accounts not named"
echo "OK: production start-up refused (exit $code) and named every placeholder."
