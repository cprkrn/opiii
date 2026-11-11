#!/usr/bin/env bash
# Pulls the latest bot code from your GitHub repo and restarts it.
# Run on the server:  sudo imessage-claude-update
# Your .env (keys, tokens) and data/ (memory, jobs, projects) are kept.
set -euo pipefail
APP=/opt/imessage-claude
REPO="${IMESSAGE_CLAUDE_REPO:-cprkrn/opiii}"
TOKF=/root/.imessage-claude-github-token
URL="https://api.github.com/repos/$REPO/tarball/main"
# Public repo: no token needed. Private repo: asks once for a read-only token.
if ! curl -fsSL "$URL" -o /tmp/imc.tgz 2>/dev/null; then
  if [ ! -s "$TOKF" ]; then
    echo "Repo looks private. Paste a GitHub fine-grained token with read access to $REPO (from github.com, not a chat app):"
    read -r T; printf %s "$T" | tr -cd 'A-Za-z0-9_' > "$TOKF"; chmod 600 "$TOKF"
  fi
  curl -fsSL -H "Authorization: Bearer $(cat "$TOKF")" "$URL" -o /tmp/imc.tgz
fi
tar xzf /tmp/imc.tgz -C "$APP" --strip-components=1 && rm -f /tmp/imc.tgz
chown -R claudebot:claudebot "$APP"
ln -sf "$APP/scripts/login.sh" /usr/local/bin/imessage-claude-login
ln -sf "$APP/scripts/update.sh" /usr/local/bin/imessage-claude-update
chmod +x "$APP"/scripts/*.sh
systemctl restart imessage-claude
sleep 4
journalctl -u imessage-claude -n 3 --no-pager
echo "UPDATED"
