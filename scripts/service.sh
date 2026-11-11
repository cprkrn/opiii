#!/usr/bin/env bash
# (Re)writes the systemd service and locks down file ownership. Run as root.
# Called by install-server.sh and update.sh.
#  - App code is owned by root, so a /code session (running as claudebot) can't modify the
#    bot or the scripts that run with sudo.
#  - Only data/ (memory, jobs, projects, sessions) is writable by the bot.
#  - .env (keys, tokens) is root-only; systemd hands its values to the bot at start.
set -euo pipefail
APP=/opt/imessage-claude
BOT=claudebot
mkdir -p "$APP/data"
chown -R root:root "$APP"
chown -R "$BOT:$BOT" "$APP/data"
chmod 755 "$APP" "$APP/scripts" "$APP/src"
[ -f "$APP/.env" ] && chown root:root "$APP/.env" && chmod 600 "$APP/.env"
ln -sf "$APP/scripts/login.sh" /usr/local/bin/imessage-claude-login
ln -sf "$APP/scripts/update.sh" /usr/local/bin/imessage-claude-update
chmod 755 "$APP"/scripts/*.sh
cat > /etc/systemd/system/imessage-claude.service <<UNIT
[Unit]
Description=iMessage Claude bot
After=network-online.target
Wants=network-online.target

[Service]
User=$BOT
WorkingDirectory=$APP
EnvironmentFile=-$APP/.env
Environment=DATA_DIR=$APP/data
ExecStart=/bin/sh $APP/scripts/entrypoint.sh
Restart=always
RestartSec=5
# Sandbox: the bot (and anything /code runs) can only write to its data folder,
# its home directory and a private /tmp, and can never gain root.
NoNewPrivileges=yes
ProtectSystem=strict
ReadWritePaths=$APP/data /home/$BOT
PrivateTmp=yes
KillMode=control-group

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable imessage-claude >/dev/null 2>&1 || true
