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
  if (!frame || frame.type !== "message" || frame.isGroup) return [];
  const from = normalizeNumber(frame.from);
  const text = String(frame.text ?? "").trim();
  const mediaUrls = (frame.attachments ?? []).map((a) => a?.url).filter(Boolean);
  if (!from || (!text && !mediaUrls.length)) return [];
  return [{ id: frame.messageId ?? null, from, text, mediaUrls }];
}

// Used when downloading attachments that need the API key.
export const authHeader = () => `Bearer ${config.claw.apiKey}`;

export async function send(to, text) {
  const res = await fetch(`${base()}/api/agent/send-message`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.claw.apiKey}` },
    body: JSON.stringify({ phone_number: to, text }),
  });
  if (!res.ok) throw new Error(`Claw send failed: ${res.status} ${await res.text().catch(() => "")}`);
}

// Keep one WebSocket open forever, reconnecting with backoff. Calls onFrame(obj).
export function listen(onFrame, log = console) {
  let backoff = 1000, socket, pinger, stopped = false;
  const connect = () => {
    if (stopped) return;
    const url = new URL(wsUrl());
    url.searchParams.set("key", config.claw.apiKey);
    socket = new WebSocket(url);
    socket.addEventListener("open", () => {
      backoff = 1000;
      log.log("Claw Messenger connected");
      pinger = setInterval(() => safeSend({ type: "ping" }), 30_000);
    });
    socket.addEventListener("message", async (ev) => {
      let frame;
      try {
        frame = JSON.parse(typeof ev.data === "string" ? ev.data : await new Response(ev.data).text());
      } catch { return; }
      if (frame.type === "ping") return safeSend({ type: "pong" });
      if (process.env.LOG_WEBHOOKS === "1") log.log("claw frame:", JSON.stringify(frame));
      onFrame(frame);
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
