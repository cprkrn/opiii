FROM node:22-slim
# git + gh + python so coding mode has real tools to work with
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates git gh ripgrep python3 python3-pip curl \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g @anthropic-ai/claude-code
WORKDIR /app
COPY package.json persona.md ./
COPY src ./src
COPY scripts ./scripts
ENV NODE_ENV=production DATA_DIR=/data
# Run as the non-root "node" user (Claude Code restricts some modes as root).
RUN mkdir -p /data && chown -R node:node /data /app
USER node
# Port 3000 only matters for webhook providers (Sendblue); Claw needs no inbound ports.
EXPOSE 3000
CMD ["sh", "scripts/entrypoint.sh"]
