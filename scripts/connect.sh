#!/usr/bin/env bash
# Connects your Gmail (read-only) and Google Calendar. Run on the server:
#   sudo imessage-claude-connect
set -euo pipefail
APP=/opt/imessage-claude
ENV="$APP/.env"
setvar() { sed -i "/^$1=/d" "$ENV"; [ -n "$2" ] && echo "$1=$2" >> "$ENV"; true; }

echo "== Gmail =="
echo "1. Open https://myaccount.google.com/apppasswords (2-Step Verification must be on)."
echo "2. Name it 'iMessage bot' and click Create. Copy the 16-letter password."
read -rp "Your Gmail address (Enter to skip email): " ADDR
if [ -n "$ADDR" ]; then
  read -rp "App password (spaces are fine): " PASS
  PASS=$(printf %s "$PASS" | tr -cd 'A-Za-z0-9')
  [ ${#PASS} -eq 16 ] || echo "(warning: app passwords are usually 16 letters, got ${#PASS})"
  setvar GMAIL_ADDRESS "$ADDR"; setvar GMAIL_APP_PASSWORD "$PASS"
fi

echo
echo "== Google Calendar =="
echo "1. On a computer open calendar.google.com > Settings (gear) > click your calendar on the left."
echo "2. Scroll to 'Integrate calendar' > copy 'Secret address in iCal format' (ends in basic.ics)."
read -rp "Secret iCal address (Enter to skip calendar): " ICAL
ICAL=$(printf %s "$ICAL" | tr -d '[:space:]')
[ -n "$ICAL" ] && setvar GOOGLE_CALENDAR_ICAL_URL "$ICAL"

chown root:root "$ENV"; chmod 600 "$ENV"
systemctl restart imessage-claude
sleep 5
journalctl -u imessage-claude -n 6 --no-pager | grep -E "Personal tools|connected|error" || true
echo
echo "Done. Text the bot: \"any important emails today?\" or \"what's on my calendar this week?\""
