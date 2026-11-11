// Fake Claw Messenger server for local testing: WebSocket /ws + REST send.
// Usage: node test/mock-claw.mjs [port]   then POST /inject {"from","text"} to simulate a text.
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const port = Number(process.argv[2] ?? 4001);
const KEY = process.env.MOCK_KEY ?? "cm_live_test";
const sockets = new Set();
let n = 0;

function frame(str) {
  const p = Buffer.from(str);
  const head = p.length < 126 ? Buffer.from([0x81, p.length]) : Buffer.from([0x81, 126, p.length >> 8, p.length & 255]);
  return Buffer.concat([head, p]);
}
function parseAll(buf) { // all masked client frames in a chunk
  const frames = [];
  while (buf.length >= 6) {
    let len = buf[1] & 127, off = 2;
    if (len === 126) { len = buf.readUInt16BE(2); off = 4; }
    const mask = buf.subarray(off, off + 4); off += 4;
    const out = Buffer.alloc(len);
    for (let i = 0; i < len; i++) out[i] = buf[off + i] ^ mask[i % 4];
    frames.push({ op: buf[0] & 15, text: out.toString() });
    buf = buf.subarray(off + len);
  }
  return frames;
}

const server = createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    if (req.url === "/api/agent/send-message") {
      if (req.headers.authorization !== `Bearer ${KEY}`) { res.writeHead(401); return res.end('{"detail":"Invalid API Key"}'); }
      const { phone_number, text } = JSON.parse(body);
      console.log(`SENT to ${phone_number}: ${text}`);
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ messageId: "out-" + ++n }));
    }
    if (req.url === "/inject") {
      const m = JSON.parse(body);
      const f = JSON.stringify({ type: "message", messageId: m.id ?? "in-" + ++n, from: m.from, text: m.text, isGroup: !!m.isGroup, chatId: m.chatId, participants: m.participants, sentAt: m.sentAt, attachments: m.attachments ?? [] });
      for (const s of sockets) s.write(frame(f));
      res.writeHead(200); return res.end(`delivered to ${sockets.size} socket(s)`);
    }
    if (req.url === "/files/test.png" && process.env.MOCK_FILE) { // a test attachment
      res.writeHead(200, { "content-type": "image/png" }); return res.end(readFileSync(process.env.MOCK_FILE));
    }
    if (req.url === "/kick") { for (const s of sockets) s.destroy(); res.writeHead(200); return res.end("kicked"); }
    res.writeHead(404); res.end();
  });
});
server.on("upgrade", (req, sock) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname !== "/ws" || url.searchParams.get("key") !== KEY) {
    sock.end("HTTP/1.1 401 Unauthorized\r\n\r\n"); return;
  }
  const accept = createHash("sha1").update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  sockets.add(sock);
  console.log("WS client connected");
  sock.on("data", (b) => { for (const f of parseAll(b)) if (f.op === 1) console.log("WS recv:", f.text); });
  sock.on("close", () => sockets.delete(sock));
  sock.on("error", () => {});
});
server.listen(port, "127.0.0.1", () => console.log(`mock claw on :${port}`));
