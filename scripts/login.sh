#!/usr/bin/env bash
# Links the bot to your Claude subscription. Run on the server:  sudo imessage-claude-login
set -e
APP=/opt/imessage-claude
if ! grep -q '^CLAW_API_KEY=.' "$APP/.env"; then
  read -rp "Paste your Claw Messenger API key (cm_live_...): " CLAW
  CLAW=$(printf %s "$CLAW" | tr -cd 'A-Za-z0-9_-')
  sed -i '/^CLAW_API_KEY=/d' "$APP/.env"; echo "CLAW_API_KEY=$CLAW" >> "$APP/.env"
fi
echo "A link will appear. Open it, sign in to Claude, approve, then copy the token"
echo "it gives you (starts with sk-ant-oat...) and paste it here."
echo
stty cols 400 2>/dev/null || true   # keep the token on one line
sudo -u claudebot -H claude setup-token || true
echo
echo ">>> Copy the sk-ant-oat token above FROM THIS TERMINAL (not from a chat app,"
echo "    which may hide it with dots), paste it, then press Enter twice:"
TOKEN=""; while IFS= read -r l && [ -n "$l" ]; do TOKEN="$TOKEN$l"; done
TOKEN=$(printf %s "$TOKEN" | tr -cd 'A-Za-z0-9_-')   # strip spaces/line breaks/stray chars
if [ "${TOKEN#sk-ant-oat}" = "$TOKEN" ] || [ ${#TOKEN} -lt 90 ]; then
  echo "That didn't look like a full token (got ${#TOKEN} chars). Run imessage-claude-login again."; exit 1
fi
sed -i '/^CLAUDE_CODE_OAUTH_TOKEN=/d' "$APP/.env"
echo "CLAUDE_CODE_OAUTH_TOKEN=$TOKEN" >> "$APP/.env"
chown root:root "$APP/.env"; chmod 600 "$APP/.env"
systemctl restart imessage-claude
sleep 4
journalctl -u imessage-claude -n 5 --no-pager
echo
echo "Done! Text your Claw Messenger number from your iPhone."
