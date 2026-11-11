import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "imc-"));
const { createHandler, chunk } = await import("../src/handler.js");
const { Store } = await import("../src/store.js");
const sendblue = await import("../src/providers/sendblue.js");

const errors = [];
const OWNER = "+15551234567";
function setup(replyFn) {
  const sent = [];
  const provider = { parseInbound: sendblue.parseInbound, send: async (to, text) => sent.push({ to, text }) };
  const calls = [];
  const brain = { reply: async (a) => { calls.push(a); return replyFn(a, calls.length); } };
  const store = new Store(mkdtempSync(join(tmpdir(), "imc-")));
  const log = { warn() {}, error: (...a) => errors.push(a.join(" ")), log() {} };
  const handle = createHandler({ config: { owners: [OWNER, "me@icloud.com"] }, store, provider, brain, log });
  return { handle, sent, calls, store };
}
const tick = () => new Promise((r) => setTimeout(r, 20));

test("replies to owner and keeps session", async () => {
  const { handle, sent, calls } = setup((a, n) => ({ text: `reply ${n}`, sessionId: "s1" }));
  handle({ from_number: OWNER, content: "hi", is_outbound: false, message_handle: "m1" });
  handle({ from_number: OWNER, content: "again", is_outbound: false, message_handle: "m2" });
  await tick();
  assert.deepEqual(sent.map((s) => s.text), ["reply 1", "reply 2"]);
  assert.equal(calls[0].sessionId, null);
  assert.equal(calls[1].sessionId, "s1");
  assert.match(calls[0].text, /hi$/);
});

test("ignores strangers, outbound echoes and duplicate webhooks", async () => {
  const { handle, sent } = setup(() => ({ text: "x", sessionId: "s" }));
  handle({ from_number: "+19998887777", content: "hey" });
  handle({ from_number: OWNER, content: "echo", is_outbound: true });
  handle({ from_number: OWNER, content: "once", message_handle: "dup" });
  handle({ from_number: OWNER, content: "once", message_handle: "dup" });
  await tick();
  assert.equal(sent.length, 1);
});

test("/new resets the session", async () => {
  const { handle, calls, sent } = setup(() => ({ text: "ok", sessionId: "s9" }));
  handle({ from_number: OWNER, content: "a", message_handle: "1" });
  handle({ from_number: OWNER, content: "/new", message_handle: "2" });
  handle({ from_number: OWNER, content: "b", message_handle: "3" });
  await tick();
  assert.equal(calls[1].sessionId, null);
  assert.match(sent[1].text, /Fresh start/);
});

test("brain errors send an apology instead of crashing", async () => {
  const { handle, sent } = setup(() => { throw new Error("boom"); });
  handle({ from_number: OWNER, content: "hi", message_handle: "e" });
  await tick();
  assert.match(sent[0].text, /error/);
});

test("10-digit numbers normalize and long replies are chunked", () => {
  assert.equal(sendblue.parseInbound({ from_number: "(555) 123-4567", content: "x" })[0].from, OWNER);
  const parts = chunk("word ".repeat(800), 1500);
  assert.ok(parts.length > 1 && parts.every((p) => p.length <= 1500));
});

test("/code switches mode with its own session; /chat switches back", async () => {
  const { handle, calls, sent } = setup((a) => ({ text: "done", sessionId: a.mode + "-s" }));
  handle({ from_number: OWNER, content: "hi", message_handle: "c1" });
  handle({ from_number: OWNER, content: "/code make a todo app", message_handle: "c2" });
  handle({ from_number: OWNER, content: "add tests", message_handle: "c3" });
  handle({ from_number: OWNER, content: "/chat", message_handle: "c4" });
  handle({ from_number: OWNER, content: "thanks", message_handle: "c5" });
  await tick();
  assert.deepEqual(calls.map((c) => [c.mode, c.sessionId]), [
    ["chat", null], ["code", null], ["code", "code-s"], ["chat", "chat-s"],
  ]);
  assert.match(calls[1].text, /make a todo app$/);
  assert.ok(sent.some((s) => s.text.includes("On it")));
});

test("claw messenger frames parse (incl. groups); pings and junk are ignored", async () => {
  const claw = await import("../src/providers/clawmessenger.js");
  assert.deepEqual(claw.parseInbound({ type: "message", messageId: "m", from: "5551234567", text: " yo ", attachments: [{ url: "https://x/img.jpg" }] }),
    [{ id: "m", from: OWNER, text: "yo", mediaUrls: ["https://x/img.jpg"] }]);
  assert.deepEqual(claw.parseInbound({ type: "message", messageId: "g1", from: OWNER, text: "g", isGroup: true, chatId: "c1", participants: ["+15550001111"] }),
    [{ id: "g1", from: OWNER, text: "g", mediaUrls: [], isGroup: true, chatId: "c1", participants: ["+15550001111"] }]);
  assert.deepEqual(claw.parseInbound({ type: "pong" }), []);
  assert.deepEqual(claw.parseInbound(null), []);
});

test("owner can be an Apple ID email too", async () => {
  const { handle, sent } = setup(() => ({ text: "hey", sessionId: "e" }));
  handle({ from_number: "Me@iCloud.com", content: "hi", message_handle: "em1" });
  await tick();
  assert.equal(sent[0]?.to, "me@icloud.com");
});

test("cron matching and job store", async () => {
  const { cronMatches, minGapMinutes } = await import("../src/cron.js");
  const { Jobs } = await import("../src/jobs.js");
  const d = new Date(2026, 10, 11, 9, 30); // Wed Nov 11 2026 09:30
  assert.ok(cronMatches("30 9 * * *", d));
  assert.ok(cronMatches("*/15 9-16 * * 1-5", d));
  assert.ok(!cronMatches("0 * * * *", d));
  assert.ok(!cronMatches("30 9 * * 0,6", d));
  assert.equal(minGapMinutes("*/15 * * * *"), 15);
  const jobs = new Jobs(mkdtempSync(join(tmpdir(), "imc-")));
  assert.throws(() => jobs.add("* * * * *", "x", "too often"), /minimum/);
  assert.throws(() => jobs.add("99 * * * *", "x", "bad"), /bad cron/);
  const j = jobs.add("0 * * * *", "btc", "check btc");
  assert.equal(jobs.all().length, 1);
  jobs.remove(j.id);
  assert.equal(jobs.all().length, 0);
});

test("job runs text the owner unless SILENT", async () => {
  const { Jobs } = await import("../src/jobs.js");
  const jobs = new Jobs(mkdtempSync(join(tmpdir(), "imc-")));
  const j1 = jobs.add("0 * * * *", "a", "x"), j2 = jobs.add("0 * * * *", "b", "y");
  const { handle, sent } = setup((a) => ({ text: a.text.includes('"a"') ? "BTC dropped 6%!" : "SILENT", sessionId: "js" }));
  await handle.runJob(j1, jobs); await handle.runJob(j2, jobs);
  assert.deepEqual(sent.map((s) => s.text), ["BTC dropped 6%!"]);
  assert.equal(jobs.all()[0].sessionId, "js");
});

test("groups: only the owner's 'claude ...' messages get replies; friends are context only", async () => {
  const sentChat = [];
  const calls = [];
  const provider = { parseInbound: (b) => [b], send: async () => {}, sendToChat: async (chatId, text) => sentChat.push({ chatId, text }) };
  const brain = { reply: async (a) => { calls.push(a); return { text: "7pm at Lucali", sessionId: "g-s" }; } };
  const store = new Store(mkdtempSync(join(tmpdir(), "imc-")));
  const log = { warn() {}, error() {}, log() {} };
  const handle = createHandler({ config: { owners: [OWNER], groups: true, groupTrigger: "claude" }, store, provider, brain, log });
  const g = (id, from, text) => handle({ id, from, text, mediaUrls: [], isGroup: true, chatId: "chat1", participants: [OWNER, "+15550001111"] });
  g("1", "+15550001111", "dinner tmrw at lucali, 7pm?");
  g("2", "+15550001111", "claude what time is dinner");     // friend using trigger: ignored
  g("3", OWNER, "sounds good");                             // owner, no trigger: context only
  g("4", OWNER, "Claude, what time is dinner?");             // owner + trigger: reply
  await tick();
  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /\+15550001111: dinner tmrw at lucali, 7pm\?/);
  assert.match(calls[0].text, /Owner asks: what time is dinner\?/);
  assert.deepEqual(sentChat, [{ chatId: "chat1", text: "7pm at Lucali" }]);
  // groups without the owner are ignored entirely
  handle({ id: "5", from: "+15550002222", text: "claude hi", mediaUrls: [], isGroup: true, chatId: "chat2", participants: ["+15550002222"] });
  await tick();
  assert.equal(calls.length, 1);
});
