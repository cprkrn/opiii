// Read-only Gmail (IMAP + app password) and Google Calendar (secret iCal link).
// Runs inside the main bot process, which holds the credentials. Claude reaches these
// functions only through the local tool broker (src/tools/broker.js), never directly.
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import ical from "node-ical";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.js";

const MAX_BODY = 6000;

export const mailEnabled = () => Boolean(config.google.gmailAddress && config.google.gmailAppPassword);
export const calendarEnabled = () => Boolean(config.google.icalUrl);

async function withMailbox(fn) {
  const client = new ImapFlow({
    host: "imap.gmail.com", port: 993, secure: true, logger: false,
    auth: { user: config.google.gmailAddress, pass: config.google.gmailAppPassword.replace(/\s+/g, "") },
  });
  await client.connect();
  // "All Mail" so searches cover archived mail too (receipts, tickets...).
  const lock = await client.getMailboxLock(["[Gmail]/All Mail", "INBOX"]);
  try { return await fn(client); }
  finally { lock.release(); await client.logout().catch(() => {}); }
}

const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const addr = (a) => clean(a?.text ?? (Array.isArray(a?.value) ? a.value.map((v) => v.name || v.address).join(", ") : ""));

// query uses normal Gmail search syntax: "from:ticketmaster newer_than:30d", "is:unread", ...
export async function searchMail(query = "newer_than:2d", limit = 10) {
  if (!mailEnabled()) throw new Error("Gmail isn't connected. On the server run: sudo imessage-claude-connect");
  limit = Math.min(Math.max(1, Number(limit) || 10), 25);
  return withMailbox(async (client) => {
    const uids = (await client.search({ gmraw: query }, { uid: true })) || [];
    const latest = uids.slice(-limit).reverse();
    const out = [];
    if (!latest.length) return out;
    for await (const m of client.fetch(latest.join(","), { uid: true, envelope: true, flags: true }, { uid: true })) {
      out.push({
        id: m.uid,
        date: m.envelope?.date?.toISOString?.() ?? null,
        from: clean(m.envelope?.from?.map((f) => f.name ? `${f.name} <${f.address}>` : f.address).join(", ")),
        subject: clean(m.envelope?.subject),
        unread: !m.flags?.has?.("\\Seen"),
      });
    }
    return out.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  });
}

// Full text of one email; attachments (tickets, receipts) are saved where Claude can Read them.
export async function readMail(id, saveDir) {
  if (!mailEnabled()) throw new Error("Gmail isn't connected.");
  return withMailbox(async (client) => {
    const m = await client.fetchOne(String(Number(id)), { source: true }, { uid: true });
    if (!m?.source) throw new Error(`no email with id ${id}`);
    const p = await simpleParser(m.source);
    const files = [];
    if (saveDir && p.attachments?.length) {
      const dir = join(saveDir, "inbox", `mail-${Number(id)}`);
      mkdirSync(dir, { recursive: true });
      for (const [i, a] of p.attachments.slice(0, 10).entries()) {
        if (a.size > 15 * 1024 * 1024) continue;
        const name = `${i}-${String(a.filename || "attachment").replace(/[^\w.-]/g, "_").slice(0, 80)}`;
        writeFileSync(join(dir, name), a.content);
        files.push(join(dir, name));
      }
    }
    const body = clean(p.text || (p.html ? String(p.html).replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, " ") : ""));
    return {
      id: Number(id), date: p.date?.toISOString?.() ?? null, from: addr(p.from), to: addr(p.to), subject: clean(p.subject),
      body: body.slice(0, MAX_BODY) + (body.length > MAX_BODY ? " …[truncated]" : ""),
      attachments: files,
    };
  });
}

// Upcoming events (recurring ones expanded) for the next `days` days.
export async function upcomingEvents(days = 7) {
  if (!calendarEnabled()) throw new Error("Calendar isn't connected. On the server run: sudo imessage-claude-connect");
  days = Math.min(Math.max(1, Number(days) || 7), 60);
  const data = await ical.async.fromURL(config.google.icalUrl);
  const start = new Date(), end = new Date(Date.now() + days * 86400_000);
  const events = [];
  for (const ev of Object.values(data)) {
    if (ev.type !== "VEVENT") continue;
    const dur = ev.end && ev.start ? ev.end - ev.start : 0;
    let starts = [];
    if (ev.rrule) {
      starts = ev.rrule.between(start, end, true);
      const ex = new Set(Object.values(ev.exdate ?? {}).map((d) => new Date(d).getTime()));
      starts = starts.filter((d) => !ex.has(d.getTime()));
    } else if (ev.start && ev.start <= end && (ev.end ?? ev.start) >= start) {
      starts = [ev.start];
    }
    for (const s of starts) {
      events.push({
        start: new Date(s).toISOString(), end: new Date(new Date(s).getTime() + dur).toISOString(),
        allDay: ev.datetype === "date", title: clean(ev.summary), location: clean(ev.location) || undefined,
      });
    }
  }
  return events.sort((a, b) => a.start.localeCompare(b.start)).slice(0, 100);
}
