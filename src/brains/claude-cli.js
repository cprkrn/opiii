// Brain that runs the official Claude Code CLI headless (`claude -p`), signed in
// with YOUR Claude subscription (CLAUDE_CODE_OAUTH_TOKEN from `claude setup-token`).
// Personal use only: Anthropic's terms don't allow serving other people this way.
//
// Two modes:
//   chat: your persona replaces Claude Code's system prompt; web tools only.
//   code: Claude Code's full coding prompt and tools, working in DATA_DIR/projects,
//         with texting-style instructions appended.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";

export const JOBS_CLI = fileURLToPath(new URL("../jobs.js", import.meta.url));

export class SessionLostError extends Error {}

export const chatDir = join(config.dataDir, "workspace");
export const projectsDir = join(config.dataDir, "projects");
mkdirSync(chatDir, { recursive: true });
mkdirSync(projectsDir, { recursive: true });

// Keep Claude Code's session history on the data volume so memory survives
// restarts, unless you've pointed CLAUDE_CONFIG_DIR somewhere yourself.
// (Only when using a token: on a laptop, your normal ~/.claude login is kept.)
const childEnv = { ...process.env, DATA_DIR: config.dataDir };
if (childEnv.CLAUDE_CODE_OAUTH_TOKEN && !childEnv.CLAUDE_CONFIG_DIR) {
  childEnv.CLAUDE_CONFIG_DIR = join(config.dataDir, "claude");
  mkdirSync(childEnv.CLAUDE_CONFIG_DIR, { recursive: true });
}

const CODE_STYLE = `
You are being driven over iMessage from the user's phone. They can't see your tool calls, diffs or terminal, only your final message.
- Work autonomously. Don't stop to ask unless you're truly blocked or about to do something destructive or irreversible (force-push, deleting branches/repos, dropping data).
- Projects live under ${projectsDir}. Clone repos there.
- End with a short plain-text summary that reads well on a phone: what you did, what changed, test results, and anything they need to decide. No markdown tables or headers. Keep code snippets tiny.
- Never print secrets or tokens.
- To schedule recurring work that texts the user (cron jobs, alerts, reminders), use: node ${JOBS_CLI} add "<cron>" "<name>" "<instructions>" (also: list, remove <id>). Runs text the user their reply, or nothing if the reply is exactly SILENT.`;

const read = (f) => readFileSync(f, "utf8");

const JOBS_HELP = `

Scheduling (you CAN do this): you can create recurring jobs that run on a schedule and text the user on their own, for alerts, reminders, daily briefings and monitoring. Use the Bash tool with exactly these commands:
  node ${JOBS_CLI} add "<cron>" "<short name>" "<instructions for the future run>"
  node ${JOBS_CLI} list
  node ${JOBS_CLI} remove <id>
  node ${JOBS_CLI} pause <id>   /   resume <id>
Cron is 5 fields in the user's local time (e.g. "0 8 * * *" = 8am daily, "0 * * * *" = hourly, "*/30 9-16 * * 1-5" = every 30 min during market hours). The minimum interval is ${process.env.JOB_MIN_INTERVAL_MINUTES ?? 15} minutes. Prefer hourly or less often unless they ask, since each run uses their Claude plan.
Write instructions so a future you can act alone: what to check, how (web search), the threshold, and to remember baselines from earlier runs. Each run of a job remembers its previous runs. A run texts the user whatever it replies, or nothing if it replies exactly SILENT.
After adding, confirm in one line with the schedule in plain English and the job id.`;

export function buildArgs({ sessionId, mode = "chat" }) {
  const c = config.claude;
  const args = ["-p", "--output-format", "json", "--strict-mcp-config"];
  if (mode === "code") {
    args.push(
      "--append-system-prompt", CODE_STYLE,
      "--tools", c.codeTools,
      "--permission-mode", c.codePermissionMode,
      "--permission-prompts", "none",
      "--max-turns", String(c.codeMaxTurns),
    );
  } else {
    // Chat gets web tools plus Bash locked to the jobs CLI (nothing else in Bash is allowed).
    // Read is for attachments they text (photos, PDFs, files); it only reaches the chat folder.
    const tools = [c.tools, "Read", c.jobs ? "Bash" : ""].filter(Boolean).join(",");
    const allowed = [c.tools, `Read(${chatDir}/**)`, c.jobs ? `Bash(node ${JOBS_CLI} *)` : ""].filter(Boolean).join(",");
    args.push(
      "--system-prompt", read(config.personaFile) + (c.jobs ? JOBS_HELP : ""),
      "--tools", tools,
      "--permission-mode", "dontAsk",
      "--permission-prompts", "none",
      "--max-turns", "12",
    );
    if (allowed) args.push("--allowedTools", allowed);
  }
  if (c.model) args.push("--model", c.model);
  if (sessionId) args.push("--resume", sessionId);
  return args;
}

function run(args, input, { cwd, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, { cwd, env: childEnv });
    let out = "", err = "";
    const timer = setTimeout(() => {
      child.kill("SIGINT"); // ends the turn cleanly so the session can be resumed
      setTimeout(() => child.kill("SIGTERM"), 5000);
      reject(new Error(`Claude timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, out, err }); });
    child.stdin.end(input); // prompt goes over stdin, never through a shell
  });
}

export async function reply({ text, sessionId, mode = "chat" }) {
  const code = mode === "code";
  const { code: exit, out, err } = await run(buildArgs({ sessionId, mode }), text, {
    cwd: code ? projectsDir : chatDir,
    timeoutMs: code ? config.claude.codeTimeoutMs : config.claude.timeoutMs,
  });
  let result;
  try {
    // With --output-format json the last line is the result object.
    result = JSON.parse(out.trim().split("\n").pop());
  } catch {
    if (sessionId && /no conversation found/i.test(err + out)) throw new SessionLostError(err || out);
    throw new Error(`claude exited ${exit}: ${(err || out).slice(0, 500)}`);
  }
  if (result.is_error) {
    const msg = String(result.result ?? result.subtype ?? "unknown error");
    if (sessionId && /no conversation found/i.test(msg)) throw new SessionLostError(msg);
    if (result.subtype === "error_max_turns" && result.session_id) {
      return { text: "I hit my step limit before finishing. Text \"continue\" and I'll keep going.", sessionId: result.session_id };
    }
    throw new Error(`Claude error: ${msg.slice(0, 500)}`);
  }
  return { text: String(result.result ?? "").trim(), sessionId: result.session_id ?? sessionId };
}
