// Local tool broker: a tiny HTTP server on 127.0.0.1 with a random per-boot token.
// Claude's chat/job sessions get the URL + token in their environment and call it via
// `node src/tools/cli.js ...`; /code and group sessions don't get the token, so they
// can't read the owner's email or calendar. Credentials never leave this process.
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { searchMail, readMail, upcomingEvents, mailEnabled, calendarEnabled } from "./google.js";

export function startBroker({ saveDir, log = console } = {}) {
  const token = randomBytes(24).toString("hex");
  const routes = {
    "mail-search": (a) => searchMail(a.query, a.limit),
    "mail-read": (a) => readMail(a.id, saveDir),
    "calendar": (a) => upcomingEvents(a.days),
    "status": async () => ({ mail: mailEnabled(), calendar: calendarEnabled() }),
  };
  const server = createServer((req, res) => {
    const reply = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
    if (req.method !== "POST" || req.headers["x-tool-token"] !== token) return reply(403, { error: "forbidden" });
    const name = req.url.replace(/^\//, "");
    if (!routes[name]) return reply(404, { error: "unknown tool" });
    let raw = "";
    req.on("data", (d) => { raw += d; if (raw.length > 10_000) req.destroy(); });
    req.on("end", async () => {
      try { reply(200, await routes[name](JSON.parse(raw || "{}"))); }
      catch (e) { log.error(`tool ${name}:`, e.message); reply(500, { error: e.message }); }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const url = `http://127.0.0.1:${server.address().port}`;
      resolve({ url, token, close: () => server.close() });
    });
  });
}
