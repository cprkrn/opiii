#!/usr/bin/env bash
# Run on the machine that will host the bot (your laptop or a server).
# Writes .env with everything the server needs.
set -e
cd "$(dirname "$0")/.."
echo "== iMessage Claude setup =="
if ! command -v node >/dev/null; then echo "Install Node 20+ first: https://nodejs.org"; exit 1; fi
if ! command -v claude >/dev/null; then
  echo "Installing Claude Code..."
  npm install -g @anthropic-ai/claude-code
fi
read -rp "Your iPhone number, plus Apple ID email if you send iMessages from it (e.g. +15551234567,you@icloud.com): " OWNER
read -rsp "Claw Messenger API key (cm_live_...): " CLAW; echo
read -rsp "GitHub token for coding mode (optional, Enter to skip): " GHT; echo
TZ_GUESS=$(cat /etc/timezone 2>/dev/null || readlink /etc/localtime 2>/dev/null | sed 's#.*/zoneinfo/##' || echo America/New_York)
read -rp "Your timezone [$TZ_GUESS]: " TZV; TZV=${TZV:-$TZ_GUESS}
echo
echo "Now sign in with your Claude subscription. A browser link will appear."
echo "When it prints a token (starts with sk-ant-oat...), copy it and paste it below."
claude setup-token
read -rsp "Paste the token: " TOKEN; echo
cat > .env <<ENV
OWNER_NUMBER=$OWNER
PROVIDER=clawmessenger
CLAW_API_KEY=$CLAW
CLAUDE_CODE_OAUTH_TOKEN=$TOKEN
CLAUDE_MODEL=claude-opus-5-5
GITHUB_TOKEN=$GHT
TZ=$TZV
ENV
chmod 600 .env
echo
echo "Saved .env (private: it holds your tokens)."
echo "Start it with:  npm start        (or: docker compose up -d --build)"
echo "Then text your Claw Messenger number from $OWNER."
