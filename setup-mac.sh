#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Install Node.js 20+ first: https://nodejs.org"; exit 1; }
command -v docker >/dev/null || { echo "Install Docker Desktop first: https://www.docker.com/products/docker-desktop/"; exit 1; }
[ -f server/.env ] || cp .env.example server/.env
npm install
npm --prefix server install
npm --prefix client install
docker compose up -d db
npm run db:push
npm run db:seed
echo "Setup complete. Run: npm run dev"
