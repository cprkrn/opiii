// Core logic, independent of HTTP: owner check, commands, per-user queue.
import { SessionLostError, projectsDir, chatDir } from "./brains/claude-cli.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, extname } from "node:path";

// Download attachments (photos, PDFs, files) next to Claude so it can open them with Read.
export async function saveAttachments(urls, dir, authHeader) {
  const inbox = join(dir, "inbox");
  mkdirSync(inbox, { recursive: true });
  const saved = [];
  for (const [i, url] of urls.entries()) {
    try {
      let res = await fetch(url);
      if ((res.status === 401 || res.status === 403) && authHeader) res = await fetch(url, { headers: { authorization: authHeader } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const type = res.headers.get("content-type") || "";
      let ext = extname(new URL(url).pathname).slice(0, 6);
      if (!ext) ext = { "image/jpeg": ".jpg", "image/png": ".png", "image/heic": ".heic", "image/gif": ".gif", "application/pdf": ".pdf", "text/plain": ".txt" }[type.split(";")[0]] || "";
      const file = join(inbox, `${Date.now()}-${i}${ext}`);
      writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      saved.push(file);
    } catch (e) {
      saved.push(`(couldn't download ${url}: ${e.message})`);
    }
  }
  return saved;
}

const HELP = [
  "Commands:",
  "/code: coding mode (Claude Code with full tools, works in your projects folder)",
  "/chat: back to normal texting mode",
  "/new: start a fresh conversation in the current mode",
  "/status: show the current mode",
  "/help: this list",
].join("\n");

export function chunk(text, max = 1500) {
  const parts = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n", max);
    if (cut < max / 2) cut = rest.lastIndexOf(" ", max);
    if (cut < max / 2) cut = max;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

function stamp(tz) {
  try {
    return new Date().toLocaleString("en-US", {
      timeZone: tz || undefined, weekday: "short", month: "short", day: "numeric",
      year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
    });
  } catch {
    return new Date().toISOString();
  }
}

export function createHandler({ config, store, provider, brain, log = console }) {
  const queues = new Map(); // one message at a time per sender

  async function processMessage(msg) {
    const { from } = msg;
    const text = msg.text.trim();

    const user = store.user(from);
    const mode = user.mode ?? "chat";
    user.sessions ??= { chat: user.sessionId ?? null, code: null };

    if (/^\/new\b/i.test(text)) {
      store.update(from, { sessions: { ...user.sessions, [mode]: null } });
      return provider.send(from, mode === "code" ? "Fresh coding session. What are we building?" : "Fresh start. What's up?");
    }
    if (/^\/help\b/i.test(text)) return provider.send(from, HELP);
    if (/^\/status\b/i.test(text)) return provider.send(from, `Mode: ${mode}`);
    const sw = text.match(/^\/(code|chat)\b\s*([\s\S]*)$/i);
    if (sw) {
      const newMode = sw[1].toLowerCase();
      store.update(from, { mode: newMode });
      if (!sw[2].trim()) {
        return provider.send(from, newMode === "code"
          ? "Coding mode on. Tell me what to build or fix (e.g. \"clone github.com/me/app and fix the login bug\"). /chat to go back."
          : "Back to chat mode.");
      }
      return processMessage({ ...msg, text: sw[2] }); // "/code fix the bug" runs right away
    }

    let prompt = `[${stamp(process.env.TZ)}]\n${text}`;
    if (msg.mediaUrls.length) {
      const files = await saveAttachments(msg.mediaUrls, mode === "code" ? projectsDir : chatDir, provider.authHeader?.());
      prompt += `\n[They sent ${files.length} attachment(s), saved at: ${files.join(", ")}. Open them with the Read tool (it can view images and PDFs).]`;
    }

    if (mode === "code") await provider.send(from, "On it 👨‍💻");
    let result;
    try {
      result = await brain.reply({ text: prompt, sessionId: user.sessions[mode], mode });
    } catch (e) {
      if (e instanceof SessionLostError) {
        log.warn("session lost, starting fresh");
        result = await brain.reply({ text: prompt, sessionId: null, mode });
      } else throw e;
    }
    store.update(from, {
      sessions: { ...user.sessions, [mode]: result.sessionId },
      messages: (user.messages ?? 0) + 1,
    });
    for (const part of chunk(result.text || "(no reply)")) await provider.send(from, part);
  }

  // ---- scheduled jobs ----
  const running = new Set();
  let jobQueue = Promise.resolve();
  async function runJob(job, jobs) {
    if (running.has(job.id)) return;
    running.add(job.id);
    const to = config.owners[0];
    const prompt = `[Scheduled job "${job.name}" (id ${job.id}), running ${stamp(process.env.TZ)}]\n` +
      `Instructions: ${job.prompt}\n\n` +
      `You remember earlier runs of this job in this conversation. If there is nothing worth texting the user about right now, reply with exactly SILENT. Otherwise reply with just the text message to send them.`;
    jobQueue = jobQueue.then(async () => {
      try {
        let r;
        try { r = await brain.reply({ text: prompt, sessionId: job.sessionId, mode: "chat" }); }
        catch (e) {
          if (!(e instanceof SessionLostError)) throw e;
          r = await brain.reply({ text: prompt, sessionId: null, mode: "chat" });
        }
        jobs.update(job.id, { sessionId: r.sessionId, lastRun: new Date().toISOString() });
        const out = (r.text || "").trim();
        if (out && !/^SILENT\b/.test(out)) for (const part of chunk(out)) await provider.send(to, part);
      } catch (e) {
        log.error(`job ${job.id} failed:`, e.message);
      } finally {
        running.delete(job.id);
      }
    });
    return jobQueue;
  }

  function handle(body) {
    const msgs = provider.parseInbound(body);
    for (const msg of msgs) {
      if (!config.owners.includes(msg.from)) {
        log.warn(`ignored message from non-owner ${msg.from}`);
        continue;
      }
      if (!store.markSeen(msg.id)) continue; // webhook retry
      const prev = queues.get(msg.from) ?? Promise.resolve();
      const next = prev
        .then(() => processMessage(msg))
        .catch(async (e) => {
          log.error("reply failed:", e.message);
          await provider.send(msg.from, "Sorry, I hit an error. Try again in a sec.").catch(() => {});
        });
      queues.set(msg.from, next);
    }
    return msgs.length;
  }
  handle.runJob = runJob;
  return handle;
}
