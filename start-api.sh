#!/bin/bash
# Starts Postgres + the Tally API locally, then exposes it via a Cloudflare
# tunnel. One-time setup before this works:
#   1. `docker compose -f backend/docker-compose.yml up -d`, then
#      `cd backend && cp .env.example .env && npm install && npx prisma db push`
#   2. Create the named tunnel once and route DNS to it:
#      `cloudflared tunnel create tally-api`
#      `cloudflared tunnel route dns tally-api api.<your-domain>`
#      (config lives in ~/.cloudflared/config.yml, same as other local projects)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TUNNEL_NAME="${TALLY_TUNNEL_NAME:-tally-api}"

cleanup() {
  echo ""
  echo "Shutting down..."
  kill "$BACKEND_PID" "$TUNNEL_PID" 2>/dev/null
  wait "$BACKEND_PID" "$TUNNEL_PID" 2>/dev/null
  exit 0
}

trap cleanup SIGINT SIGTERM

echo "Starting Postgres..."
docker compose -f "$SCRIPT_DIR/docker-compose.yml" up -d

echo "Starting tally-api..."
cd "$SCRIPT_DIR/backend" && npm run dev &
BACKEND_PID=$!

echo "Waiting for backend to be ready..."
until curl -sf http://localhost:8000/health > /dev/null 2>&1; do
  sleep 1
done

echo "Backend ready. Starting Cloudflare tunnel..."
cloudflared tunnel run "$TUNNEL_NAME" &
TUNNEL_PID=$!

echo ""
echo "tally-api is running locally on :8000 and tunneled via '$TUNNEL_NAME'."
echo "Press Ctrl+C to stop."

wait "$BACKEND_PID" "$TUNNEL_PID"
