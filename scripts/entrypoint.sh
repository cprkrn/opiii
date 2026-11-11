#!/bin/sh
set -e
# Let coding mode clone/push your GitHub repos if you set GITHUB_TOKEN.
if [ -n "$GITHUB_TOKEN" ]; then
  git config --global credential.helper '!f() { echo username=x-access-token; echo "password=$GITHUB_TOKEN"; }; f'
  export GH_TOKEN="$GITHUB_TOKEN"
fi
git config --global user.name  "${GIT_AUTHOR_NAME:-iMessage Claude}"
git config --global user.email "${GIT_AUTHOR_EMAIL:-imessage-claude@users.noreply.github.com}"
mkdir -p "${DATA_DIR:-/data}"
exec node src/server.js
