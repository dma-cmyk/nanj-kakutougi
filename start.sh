#!/usr/bin/env bash
set -euo pipefail
PORT="${1:-8080}"
cd "$(dirname "$0")"
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo "=== なんJ格闘技大会 ローカルサーバー ==="
echo "PC:     http://localhost:${PORT}/"
if [ -n "${IP}" ]; then
  echo "スマホ: http://${IP}:${PORT}/"
fi
exec python3 -m http.server "${PORT}" --bind 0.0.0.0
