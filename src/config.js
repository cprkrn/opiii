import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// Tiny .env loader so there are zero dependencies. Real env vars win.
const envPath = resolve(".env");
let envText = "";
try { if (existsSync(envPath)) envText = readFileSync(envPath, "utf8"); } catch {}
{
  for (const line of envText.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

const env = (k, d = "") => (process.env[k] ?? d).trim();

export const config = {
  port: Number(env("PORT", "3000")),
  // Phone number and/or Apple ID email(s), comma-separated. Only these get replies.
  owners: env("OWNER_NUMBER").split(",").map(normalizeNumber).filter(Boolean),
  webhookSecret: env("WEBHOOK_SECRET"),
  provider: env("PROVIDER", "clawmessenger"),
  // Group chats: only an owner's message starting with the trigger word gets a reply.
  groups: env("GROUPS", "1") !== "0",
  groupTrigger: env("GROUP_TRIGGER", "claude"),
  brain: env("BRAIN", "claude-cli"),
  dataDir: resolve(env("DATA_DIR", "./data")),
  personaFile: resolve(env("PERSONA_FILE", "./persona.md")),
  claude: {
    model: env("CLAUDE_MODEL", "claude-opus-5-5"),
    tools: env("CLAUDE_TOOLS", "WebSearch,WebFetch"),
    jobs: env("ENABLE_JOBS", "1") !== "0",
    chatEffort: env("CLAUDE_CHAT_EFFORT", "low"),
    codeEffort: env("CLAUDE_CODE_EFFORT", "high"),
    timeoutMs: Number(env("CLAUDE_TIMEOUT_SECONDS", "180")) * 1000,
    // Coding mode (/code)
    codeTools: env("CLAUDE_CODE_TOOLS", "default"),
    codePermissionMode: env("CLAUDE_CODE_PERMISSION_MODE", "auto"),
    codeMaxTurns: Number(env("CLAUDE_CODE_MAX_TURNS", "80")),
    codeTimeoutMs: Number(env("CLAUDE_CODE_TIMEOUT_MINUTES", "20")) * 60 * 1000,
  },
  // Friends: other people who may text the bot. They NEVER use your Claude subscription;
  // they go to any OpenAI-compatible API you configure (OpenRouter, Groq, Ollama, ...).
  friends: {
    numbers: env("FRIENDS").split(",").map(normalizeNumber).filter(Boolean),
    apiBase: env("FRIENDS_API_BASE"),
    apiKey: env("FRIENDS_API_KEY"),
    model: env("FRIENDS_MODEL"),
    dailyLimit: Number(env("FRIENDS_DAILY_LIMIT", "30")),
    open: env("FRIENDS_OPEN", "0") === "1", // 1 = anyone who can reach the number (Claw still requires registration)
  },
  // Read-only Gmail (IMAP app password) + Google Calendar (secret iCal link).
  google: {
    gmailAddress: env("GMAIL_ADDRESS"),
    gmailAppPassword: env("GMAIL_APP_PASSWORD"),
    icalUrl: env("GOOGLE_CALENDAR_ICAL_URL"),
  },
  claw: {
    apiKey: env("CLAW_API_KEY"),
    baseUrl: env("CLAW_BASE_URL", "https://claw-messenger.onrender.com"),
  },
  sendblue: {
    apiKeyId: env("SENDBLUE_API_KEY_ID"),
    apiSecretKey: env("SENDBLUE_API_SECRET_KEY"),
    fromNumber: normalizeNumber(env("SENDBLUE_FROM_NUMBER")),
  },
};

// Normalizes an iMessage handle: phone -> E.164, email -> lowercase.
export function normalizeNumber(n) {
  if (!n) return "";
  n = String(n).trim();
  if (n.includes("@")) return n.toLowerCase().replace(/^mailto:/, "");
  const digits = String(n).replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.length === 10) return "+1" + digits; // assume US
  return "+" + digits;
}

export function validateConfig() {
  const problems = [];
  if (!config.owners.length) problems.push("OWNER_NUMBER is required (your phone number and/or Apple ID email)");
  // Webhook providers need a secret URL; Claw Messenger uses an outbound WebSocket.
  const needsWebhook = config.provider !== "clawmessenger";
  if (needsWebhook && (!config.webhookSecret || config.webhookSecret.length < 16))
    problems.push("WEBHOOK_SECRET must be at least 16 characters");
  if (config.provider === "clawmessenger" && !config.claw.apiKey)
    problems.push("CLAW_API_KEY is required (cm_live_... from your Claw Messenger dashboard)");
  if (process.env.ANTHROPIC_API_KEY)
    problems.push(
      "ANTHROPIC_API_KEY is set: Claude Code would bill the API instead of your subscription. Remove it."
    );
  if (config.provider === "sendblue") {
    const s = config.sendblue;
    if (!s.apiKeyId || !s.apiSecretKey)
      problems.push("SENDBLUE_API_KEY_ID and SENDBLUE_API_SECRET_KEY are required");
  }
  return problems;
}
