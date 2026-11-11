import { createServer } from "node:http";
import { config, validateConfig } from "./config.js";
import { Store } from "./store.js";
import { getProvider } from "./providers/index.js";
import { getBrain } from "./brains/index.js";
import { createHandler } from "./handler.js";
import { Jobs } from "./jobs.js";
import { cronMatches } from "./cron.js";
import * as friendsBrain from "./brains/openai-compatible.js";

// Never let one bad event or promise take the whole bot down.
process.on("unhandledRejection", (e) => console.error("unhandled rejection:", e?.message ?? e));
process.on("uncaughtException", (e) => console.error("uncaught exception:", e?.message ?? e));

const problems = validateConfig();
if (problems.length) {
  console.error("Config problems:\n - " + problems.join("\n - "));
  process.exit(1);
}

const provider = getProvider(config.provider);
const store = new Store(config.dataDir);
const jobs = config.claude.jobs ? new Jobs(config.dataDir) : null;
const handle = createHandler({
  config,
  store,
  provider,
  brain: getBrain(config.brain),
  friendsBrain,
  jobs,
});
if (friendsBrain.enabled()) console.log(`Friends mode on: ${config.friends.model} via ${config.friends.apiBase}`);

// Scheduler: re-armed on every minute boundary (no drift). Each tick checks every minute
// since the last tick, so a slow tick or short restart doesn't skip or double a run.
if (jobs) {
  let last = Math.floor(Date.now() / 60_000);
  const tick = () => {
    try {
      const nowMin = Math.floor(Date.now() / 60_000);
      const from = Math.max(last + 1, nowMin - 5); // catch up at most 5 minutes
      for (const job of jobs.all()) {
        try {
          if (job.paused) continue;
          if (job.once) { if (Date.parse(job.once) <= Date.now()) handle.runJob(job, jobs); continue; }
          for (let m = from; m <= nowMin; m++) {
            if (cronMatches(job.cron, new Date(m * 60_000))) { handle.runJob(job, jobs); break; }
          }
        } catch (e) { console.error(`job ${job.id}:`, e.message); }
      }
      last = nowMin;
    } catch (e) { console.error("scheduler:", e.message); }
    setTimeout(tick, 60_000 - (Date.now() % 60_000) + 500);
  };
  setTimeout(tick, 60_000 - (Date.now() % 60_000) + 500);
}

// Push providers (Claw Messenger) deliver over a socket we open: no public URL needed.
if (provider.listen) provider.listen((frame) => handle(frame), console, { lastSeen: () => store.lastSeen() });

const webhookPath = config.webhookSecret ? `/webhook/${config.webhookSecret}` : null;

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "content-type": "text/plain" });
    return res.end("imessage-claude is running");
  }
  if (req.method !== "POST" || !webhookPath || req.url !== webhookPath) {
    res.writeHead(404);
    return res.end();
  }
  let raw = "";
  req.on("data", (d) => {
    raw += d;
    if (raw.length > 1_000_000) req.destroy();
  });
  req.on("end", () => {
    // Answer right away so the provider doesn't retry; Claude works in the background.
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"ok":true}');
    try {
      const body = JSON.parse(raw || "{}");
      if (process.env.LOG_WEBHOOKS === "1") console.log("webhook:", JSON.stringify(body));
      handle(body);
    } catch (e) {
      console.error("bad webhook body:", e.message);
    }
  });
});

server.listen(config.port, () => {
  console.log(`Listening on :${config.port}  provider=${config.provider} brain=${config.brain}`);
  if (provider.listen) console.log("Receiving texts over the provider's WebSocket (no public URL needed).");
  else console.log("Webhook path: /webhook/<WEBHOOK_SECRET>");
});
