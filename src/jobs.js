#!/usr/bin/env node
// Scheduled jobs ("cron") for the bot. Stored in DATA_DIR/jobs.json.
// Claude manages them from chat by running this file as a CLI:
//   node src/jobs.js add "<cron>" "<name>" "<instructions>"
//   node src/jobs.js list
//   node src/jobs.js remove <id>
//   node src/jobs.js pause <id> | resume <id>
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { parseCron, minGapMinutes } from "./cron.js";

export const MIN_GAP = Number(process.env.JOB_MIN_INTERVAL_MINUTES ?? 15);
export const MAX_JOBS = Number(process.env.MAX_JOBS ?? 15);

// "2026-12-03 09:00" (local time) or any ISO string -> Date
export function parseWhen(s) {
  const m = String(s).trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/);
  const d = m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : new Date(s);
  if (isNaN(d)) throw new Error(`can't read time "${s}" (use YYYY-MM-DD HH:MM)`);
  return d;
}

export class Jobs {
  constructor(dir) {
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, "jobs.json");
  }
  all() {
    if (!existsSync(this.file)) return [];
    try {
      const list = JSON.parse(readFileSync(this.file, "utf8"));
      return Array.isArray(list) ? list : [];
    } catch (e) {
      renameSync(this.file, `${this.file}.corrupt-${Date.now()}`);
      console.error("jobs.json was corrupt; saved a copy and started fresh:", e.message);
      return [];
    }
  }
  save(list) {
    writeFileSync(this.file + ".tmp", JSON.stringify(list, null, 2));
    renameSync(this.file + ".tmp", this.file);
  }
  add(cron, name, prompt) {
    parseCron(cron); // throws on bad syntax
    const gap = minGapMinutes(cron);
    if (gap < MIN_GAP) throw new Error(`runs every ${gap} min; minimum is ${MIN_GAP} (protects your Claude usage limits)`);
    if (!prompt?.trim()) throw new Error("instructions are required");
    if (this.all().length >= MAX_JOBS) throw new Error(`already ${MAX_JOBS} jobs; remove one first`);
    const job = { id: randomBytes(3).toString("hex"), cron, name: name || "job", prompt, paused: false, sessionId: null, created: new Date().toISOString(), lastRun: null };
    this.save([...this.all(), job]);
    return job;
  }
  at(when, name, prompt) {
    const d = parseWhen(when);
    if (d.getTime() < Date.now() - 60_000) throw new Error("that time is in the past");
    if (!prompt?.trim()) throw new Error("instructions are required");
    if (this.all().length >= MAX_JOBS) throw new Error(`already ${MAX_JOBS} jobs; remove one first`);
    const job = { id: randomBytes(3).toString("hex"), once: d.toISOString(), name: name || "reminder", prompt, paused: false, sessionId: null, created: new Date().toISOString(), lastRun: null };
    this.save([...this.all(), job]);
    return job;
  }
  update(id, patch) {
    const list = this.all();
    const j = list.find((x) => x.id === id);
    if (!j) throw new Error(`no job ${id}`);
    Object.assign(j, patch);
    this.save(list);
    return j;
  }
  remove(id) {
    const list = this.all();
    if (!list.some((x) => x.id === id)) throw new Error(`no job ${id}`);
    this.save(list.filter((x) => x.id !== id));
  }
}

// ---- CLI ----
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const jobs = new Jobs(resolve(process.env.DATA_DIR ?? "./data"));
  const [cmd, ...a] = process.argv.slice(2);
  try {
    if (cmd === "add") {
      const j = jobs.add(a[0], a[1], a.slice(2).join(" "));
      console.log(`added job ${j.id} "${j.name}" (${j.cron})`);
    } else if (cmd === "at") {
      const j = jobs.at(a[0], a[1], a.slice(2).join(" "));
      console.log(`added one-time job ${j.id} "${j.name}" at ${new Date(j.once).toLocaleString()}`);
    } else if (cmd === "list") {
      const l = jobs.all();
      console.log(l.length ? l.map((j) => `${j.id}  ${j.paused ? "[paused] " : ""}${j.once ? "once " + new Date(j.once).toLocaleString() : j.cron}  ${j.name}: ${j.prompt}`).join("\n") : "no jobs");
    } else if (cmd === "remove") { jobs.remove(a[0]); console.log(`removed ${a[0]}`); }
    else if (cmd === "pause") { jobs.update(a[0], { paused: true }); console.log(`paused ${a[0]}`); }
    else if (cmd === "resume") { jobs.update(a[0], { paused: false }); console.log(`resumed ${a[0]}`); }
    else { console.log('usage: jobs.js add "<cron>" "<name>" "<instructions>" | at "<YYYY-MM-DD HH:MM>" "<name>" "<instructions>" | list | remove <id> | pause <id> | resume <id>'); process.exit(1); }
  } catch (e) { console.error("error:", e.message); process.exit(1); }
}
