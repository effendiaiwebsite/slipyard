#!/usr/bin/env bash
#
# SlipYard server bootstrap — Ubuntu 22.04/24.04 on AWS Lightsail (ca-central-1).
# Installs Node, pnpm, ClamAV, Caddy, the app, its systemd service, and an env
# skeleton. Safe to re-run. Run as a sudo-capable user (e.g. ubuntu):
#
#   curl -fsSL https://raw.githubusercontent.com/effendiaiwebsite/slipyard/main/deploy/setup-server.sh | sudo bash
#   # or, if the repo is private / already cloned:
#   sudo bash /opt/slipyard/deploy/setup-server.sh
#
# After it finishes: edit /etc/slipyard/slipyard.env, then run deploy/deploy.sh.
set -euo pipefail

REPO="${SLIPYARD_REPO:-https://github.com/effendiaiwebsite/slipyard.git}"
APP_DIR="/opt/slipyard"
APP_USER="slipyard"
NODE_MAJOR="22"

if [ "$(id -u)" -ne 0 ]; then echo "Run with sudo/root." >&2; exit 1; fi

echo "==> [1/8] swap (next build + ClamAV need memory headroom on small instances)"
if ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> [2/8] base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl git ca-certificates gnupg postgresql-client debian-keyring debian-archive-keyring apt-transport-https

echo "==> [3/8] Node ${NODE_MAJOR} + pnpm (corepack)"
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d. -f1 | tr -d v)" != "$NODE_MAJOR" ]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi
corepack enable
corepack prepare pnpm@latest --activate

echo "==> [4/8] ClamAV daemon + freshclam, TCP on 127.0.0.1:3310"
apt-get install -y clamav clamav-daemon
systemctl stop clamav-freshclam >/dev/null 2>&1 || true
echo "    fetching initial virus definitions (clamd will not start without them)…"
freshclam || true
if ! grep -q '^TCPSocket 3310' /etc/clamav/clamd.conf; then
  { echo 'TCPSocket 3310'; echo 'TCPAddr 127.0.0.1'; } >> /etc/clamav/clamd.conf
fi
systemctl enable --now clamav-freshclam
systemctl enable clamav-daemon
systemctl restart clamav-daemon

echo "==> [5/8] app user + code at ${APP_DIR}"
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"
if [ ! -d "$APP_DIR/.git" ]; then
  git clone "$REPO" "$APP_DIR"
fi
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"

echo "==> [6/8] env skeleton at /etc/slipyard/slipyard.env"
install -d -m 750 -o root -g "$APP_USER" /etc/slipyard
if [ ! -f /etc/slipyard/slipyard.env ]; then
  install -m 640 -o root -g "$APP_USER" "$APP_DIR/deploy/slipyard.env.example" /etc/slipyard/slipyard.env
  NEED_ENV=1
fi

echo "==> [7/8] systemd service + sudoers (let slipyard restart its own service)"
install -m 644 "$APP_DIR/deploy/slipyard.service" /etc/systemd/system/slipyard.service
echo "$APP_USER ALL=(root) NOPASSWD: /usr/bin/systemctl restart slipyard, /usr/bin/systemctl status slipyard" > /etc/sudoers.d/slipyard
chmod 440 /etc/sudoers.d/slipyard
systemctl daemon-reload
systemctl enable slipyard

echo "==> [8/8] Caddy (automatic HTTPS reverse proxy)"
if ! command -v caddy >/dev/null 2>&1; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  apt-get update -y
  apt-get install -y caddy
fi
install -m 644 "$APP_DIR/deploy/Caddyfile" /etc/caddy/Caddyfile
systemctl restart caddy

echo ""
echo "=================================================================="
echo " Bootstrap complete. Next steps:"
echo "  1. Edit  /etc/slipyard/slipyard.env  with real values"
echo "     (RDS DATABASE_URL, AWS keys, KMS, SES, Stripe LIVE, Twilio, secrets)."
echo "  2. First deploy:"
echo "       sudo -u ${APP_USER} bash ${APP_DIR}/deploy/deploy.sh"
echo "  3. In Cloudflare, point slipyard.ca (and www) A records at this"
echo "     instance's static IP, set to DNS-only (grey cloud)."
echo "  4. Update Stripe + Twilio webhooks to https://slipyard.ca/..."
[ "${NEED_ENV:-0}" = "1" ] && echo "  !! The service will NOT start until slipyard.env is filled in."
echo "=================================================================="
