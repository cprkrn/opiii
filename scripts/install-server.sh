#!/usr/bin/env bash
# One-shot installer for a fresh Ubuntu/Debian server (e.g. a $6 DigitalOcean droplet).
# Run from inside the project folder:   sudo ./scripts/install-server.sh
# Installs Node + Claude Code, asks your setup questions, and runs the bot as a
# background service that starts on boot and restarts if it crashes.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run with sudo: sudo ./scripts/install-server.sh"; exit 1; }
SRC="$(cd "$(dirname "$0")/.." && pwd)"
APP=/opt/imessage-claude
BOT=claudebot

echo "== Installing system packages =="
apt-get update -qq
apt-get install -y -qq ca-certificates curl git python3 ripgrep >/dev/null
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
command -v claude >/dev/null || npm install -g @anthropic-ai/claude-code >/dev/null
# Small droplets: add swap so Claude Code coding runs don't run out of memory.
if [ ! -f /swapfile ] && [ "$(free -m | awk '/Mem:/{print $2}')" -lt 2000 ]; then
  if fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile; then
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
  else
    rm -f /swapfile; echo "(couldn't add swap; continuing)"
  fi
fi

echo "== Creating bot user and copying app to $APP =="
id "$BOT" >/dev/null 2>&1 || useradd -m -s /bin/bash "$BOT"
mkdir -p "$APP"
if [ "$SRC" != "$APP" ]; then cp -a "$SRC/." "$APP/"; fi
chown -R "$BOT:$BOT" "$APP"

if [ ! -f "$APP/.env" ]; then
  echo "== Setup questions =="
  sudo -u "$BOT" -H bash "$APP/scripts/setup.sh"
fi
grep -q '^DATA_DIR=' "$APP/.env" || echo "DATA_DIR=$APP/data" >> "$APP/.env"

echo "== Installing background service =="
cat > /etc/systemd/system/imessage-claude.service <<UNIT
[Unit]
Description=iMessage Claude bot
After=network-online.target
Wants=network-online.target

[Service]
User=$BOT
WorkingDirectory=$APP
ExecStart=/bin/sh $APP/scripts/entrypoint.sh
Environment=DATA_DIR=$APP/data
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
ln -sf "$APP/scripts/login.sh" /usr/local/bin/imessage-claude-login
ln -sf "$APP/scripts/update.sh" /usr/local/bin/imessage-claude-update
systemctl daemon-reload
systemctl enable --now imessage-claude >/dev/null
sleep 4
systemctl --no-pager --lines=8 status imessage-claude || true
echo
if grep -q '^CLAUDE_CODE_OAUTH_TOKEN=.' "$APP/.env"; then
  echo "Done. Text your Claw Messenger number from your iPhone."
else
  echo "Almost done: run  sudo imessage-claude-login  to link your Claude subscription."
fi
echo "Logs:    sudo journalctl -u imessage-claude -f"
echo "Restart: sudo systemctl restart imessage-claude"
