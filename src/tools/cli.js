#!/usr/bin/env node
// What Claude runs (via Bash) to read the owner's email and calendar:
//   node src/tools/cli.js mail-search "<gmail search>" [limit]
//   node src/tools/cli.js mail-read <id>
//   node src/tools/cli.js calendar [days]
// It talks to the local broker in the bot process; it holds no credentials itself.
const [cmd, ...a] = process.argv.slice(2);
const url = process.env.TOOL_URL, token = process.env.TOOL_TOKEN;
if (!url || !token) { console.error("Email/calendar tools aren't available in this mode."); process.exit(1); }
const args = {
  "mail-search": () => ({ query: a[0] ?? "newer_than:2d", limit: a[1] }),
  "mail-read": () => ({ id: a[0] }),
  "calendar": () => ({ days: a[0] }),
  "status": () => ({}),
}[cmd];
if (!args) {
  console.error('usage: cli.js mail-search "<gmail search>" [limit] | mail-read <id> | calendar [days] | status');
  process.exit(1);
}
const res = await fetch(`${url}/${cmd}`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-tool-token": token },
  body: JSON.stringify(args()),
  signal: AbortSignal.timeout(60_000),
}).catch((e) => ({ ok: false, json: async () => ({ error: e.message }) }));
const data = await res.json().catch(() => ({ error: "bad response" }));
if (!res.ok) { console.error("error:", data.error); process.exit(1); }
console.log(JSON.stringify(data, null, 1));
