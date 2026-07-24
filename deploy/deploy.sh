#!/usr/bin/env bash
#
# SlipYard deploy/redeploy — pull latest, install, build, migrate, restart.
# Run as the slipyard user:
#
#   sudo -u slipyard bash /opt/slipyard/deploy/deploy.sh
#
# Migrations are additive and idempotent (drizzle tracks what's applied), so
# this is safe to run on every deploy. Production is NEVER seeded.
set -euo pipefail

APP_DIR="/opt/slipyard"
ENV_FILE="/etc/slipyard/slipyard.env"
cd "$APP_DIR"

echo "==> git pull"
git pull --ff-only

echo "==> install (incl. dev deps — needed for next build + tsx migrate)"
pnpm install --prod=false --frozen-lockfile

echo "==> build"
pnpm build

echo "==> migrate RDS (drizzle)"
set -a; # shellcheck disable=SC1090
source "$ENV_FILE"; set +a
pnpm db:migrate

echo "==> restart service"
sudo /usr/bin/systemctl restart slipyard
sleep 3
sudo /usr/bin/systemctl status slipyard --no-pager | head -6 || true

echo "==> done."
