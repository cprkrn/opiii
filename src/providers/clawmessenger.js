// Claw Messenger (clawmessenger.com): cheap managed iMessage, about $5/mo.
// - Inbound arrives over a WebSocket we open, so no public URL, domain or
//   tunnel is needed.
// - Outbound is a REST call.
// Protocol (from Claw's official plugin + public integrations):
//   WS   wss://claw-messenger.onrender.com/ws?key=cm_live_...
//        server -> {type:"message", messageId, from, text, attachments:[{url,mimeType}], isGroup}
//        both ways -> {type:"ping"} / {type:"pong"}
//   REST POST https://claw-messenger.onrender.com/api/agent/send-message
//        Authorization: Bearer cm_live_...   body {phone_number, text}
import { config, normalizeNumber } from "../config.js";

const base = () => config.claw.baseUrl.replace(/\/$/, "");
const wsUrl = () => base().replace(/^http/, "ws") + "/ws";

export function parseInbound(frame) {
  if (!frame || frame.type !== "message") return [];
  const from = normalizeNumber(frame.from);
  const text = String(frame.text ?? "").trim();
  const mediaUrls = (Array.isArray(frame.attachments) ? frame.attachments : []).map((a) => a?.url).filter((u) => typeof u === "string");
  if (!from || (!text && !mediaUrls.length)) return [];
  const msg = { id: frame.messageId ?? null, from, text, mediaUrls };
  if (frame.sentAt) msg.sentAt = frame.sentAt;
  if (frame.isGroup) {
    msg.isGroup = true;
    msg.chatId = frame.chatId;
    if (frame.groupName) msg.groupName = frame.groupName;
    msg.participants = (frame.participants ?? []).map((p) => normalizeNumber(p?.address ?? p?.phone ?? p)).filter(Boolean);
  }
  return [msg];
}

// Group replies go over the WebSocket: {type:"send", chatId, parts:[{type:"text", value}]}.
let liveSocket = null;
const pending = new Map();
const newId = () => "imc-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
// Fire-and-forget frames (typing, read receipts, reactions don't count toward Claw's message cap).
function wsSend(frame) {
  try { if (liveSocket?.readyState === 1) { liveSocket.send(JSON.stringify(frame)); return true; } } catch {}
  return false;
}
const target = (t) => (t.chatId ? { chatId: t.chatId } : { to: t.to });
export const markRead = (t) => wsSend({ type: "read", ...target(t) });
export const typing = (t, on) => wsSend({ type: on ? "typing.start" : "typing.stop", ...target(t) });
const STANDARD = { "❤️": "love", "❤": "love", "👍": "like", "👎": "dislike", "😂": "laugh", "‼️": "emphasize", "❓": "question" };
export function react(messageId, emoji) {
  if (!messageId || !emoji) return false;
  const std = STANDARD[emoji];
  return wsSend({ type: "reaction", id: newId(), messageId, reactionType: std ?? "custom", ...(std ? {} : { emoji }), remove: false });
}

export function sendToChat(chatId, text, { replyTo } = {}) {
  if (!liveSocket || liveSocket.readyState !== 1) return Promise.reject(new Error("Claw socket not connected"));
  const id = newId();
  liveSocket.send(JSON.stringify({ type: "send", id, chatId, parts: [{ type: "text", value: text }], ...(replyTo ? { replyTo: { messageId: replyTo } } : {}) }));
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { pending.delete(id); resolve(); }, 15_000); // no ack: assume sent
    pending.set(id, (r) => {
      clearTimeout(t);
      r.ok === false || r.status === "failed" ? reject(new Error(`Claw group send failed: ${r.error ?? JSON.stringify(r)}`)) : resolve();
    });
  });
}

// Used when downloading attachments that need the API key.
export const authHeader = () => `Bearer ${config.claw.apiKey}`;
export const apiHost = () => new URL(base()).host;

export async function send(to, text) {
  const res = await fetch(`${base()}/api/agent/send-message`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.claw.apiKey}` },
    body: JSON.stringify({ phone_number: to, text }),
  });
  if (!res.ok) throw new Error(`Claw send failed: ${res.status} ${await res.text().catch(() => "")}`);
}

// Keep one WebSocket open forever, reconnecting with backoff. Calls onFrame(obj).
// lastSeen() -> ISO time of the newest message handled; on reconnect we ask Claw to replay
// anything newer that arrived while we were disconnected (dedupe drops repeats).
export function listen(onFrame, log = console, { lastSeen } = {}) {
  let backoff = 1000, socket, pinger, stopped = false, lastPong = Date.now();
  const connect = () => {
    if (stopped) return;
    const url = new URL(wsUrl());
    url.searchParams.set("key", config.claw.apiKey);
    socket = new WebSocket(url);
    socket.addEventListener("open", () => {
      backoff = 1000;
      liveSocket = socket;
      const since = lastSeen?.();
      if (since) safeSend({ type: "sync", since });
      log.log("Claw Messenger connected");
      lastPong = Date.now();
      pinger = setInterval(() => {
        // Half-open sockets look alive forever; if Claw stops answering pings, reconnect.
        if (Date.now() - lastPong > 90_000) { log.warn("Claw stopped answering; reconnecting"); try { socket.close(); } catch {} return retry("stale"); }
        safeSend({ type: "ping" });
      }, 30_000);
    });
    socket.addEventListener("message", async (ev) => {
      let frame;
      try {
        frame = JSON.parse(typeof ev.data === "string" ? ev.data : await new Response(ev.data).text());
      } catch { return; }
      if (!frame || typeof frame !== "object") return;
      lastPong = Date.now(); // any traffic proves the socket is alive
      if (frame.type === "ping") return safeSend({ type: "pong" });
      if (frame.type === "pong") return;
      if ((frame.type === "send.result" || frame.type === "error") && pending.has(frame.id)) {
        const done = pending.get(frame.id); pending.delete(frame.id); return done(frame);
      }
      if (process.env.LOG_WEBHOOKS === "1") log.log("claw frame:", JSON.stringify(frame));
      try { onFrame(frame); } catch (e) { log.error("frame handler error:", e.message); }
    });
    let retried = false, opened = false;
    const retry = (why) => {
      clearInterval(pinger);
      if (stopped || retried) return;
      retried = true;
      const hint = opened ? "" : " (if this keeps happening, check CLAW_API_KEY)";
      log.warn(`Claw socket ${why}${hint}; retrying in ${backoff / 1000}s`);
      setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 60_000);
    };
    socket.addEventListener("open", () => { opened = true; });
    // A failed handshake fires "error" without "close" in Node, so retry on either.
    socket.addEventListener("close", (ev) => retry(`closed (${ev.code})`));
    socket.addEventListener("error", () => retry("connection failed"));
  };
  const safeSend = (obj) => { try { socket?.readyState === 1 && socket.send(JSON.stringify(obj)); } catch {} };
  connect();
  return () => { stopped = true; clearInterval(pinger); socket?.close(); };
}
