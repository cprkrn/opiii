import { createServer } from "node:http";
import { config, validateConfig } from "./config.js";
import { Store } from "./store.js";
import { getProvider } from "./providers/index.js";
import { getBrain } from "./brains/index.js";
import { createHandler } from "./handler.js";
import { Jobs } from "./jobs.js";
import { cronMatches } from "./cron.js";

const problems = validateConfig();
if (problems.length) {
  console.error("Config problems:\n - " + problems.join("\n - "));
  process.exit(1);
}

const provider = getProvider(config.provider);
const handle = createHandler({
  config,
  store: new Store(config.dataDir),
  provider,
  brain: getBrain(config.brain),
});

// Scheduler: once a minute, run any jobs whose cron matches.
if (config.claude.jobs) {
  const jobs = new Jobs(config.dataDir);
  const tick = () => {
    const now = new Date();
    for (const job of jobs.all()) {
      try {
        if (!job.paused && cronMatches(job.cron, now)) handle.runJob(job, jobs);
      } catch (e) { console.error(`job ${job.id}:`, e.message); }
    }
  };
  setTimeout(() => { tick(); setInterval(tick, 60_000); }, 60_000 - (Date.now() % 60_000) + 500);
}

// Push providers (Claw Messenger) deliver over a socket we open: no public URL needed.
if (provider.listen) provider.listen((frame) => handle(frame));

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
