// Minimal JSON-file store: maps a phone number to its Claude Code session id.
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { join } from "node:path";

export class Store {
  constructor(dir) {
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, "state.json");
    this.data = { users: {}, seen: [] };
    if (existsSync(this.file)) {
      try { this.data = JSON.parse(readFileSync(this.file, "utf8")); }
      catch (e) {
        // A half-written file shouldn't take the bot down: keep a copy, start fresh.
        renameSync(this.file, `${this.file}.corrupt-${Date.now()}`);
        console.error("state.json was corrupt; saved a copy and started fresh:", e.message);
      }
    }
    this.data.users ??= {};
    this.data.seen ??= [];
    this.data.friends ??= {};
    this.data.groups ??= {};
  }
  user(number) {
    return (this.data.users[number] ??= { sessionId: null, messages: 0 });
  }
  update(number, patch) {
    Object.assign(this.user(number), patch);
    this.save();
  }
  friend(n) {
    return (this.data.friends[n] ??= { history: [], day: null, count: 0 });
  }
  updateFriend(n, patch) {
    Object.assign(this.friend(n), patch);
    this.save();
  }
  group(chatId) {
    return (this.data.groups[chatId] ??= { sessionId: null, recent: [] });
  }
  updateGroup(chatId, patch) {
    Object.assign(this.group(chatId), patch);
    this.save();
  }
  addGroupMessage(chatId, m) {
    const g = this.group(chatId);
    g.recent.push({ ...m, at: new Date().toISOString() });
    if (g.recent.length > 40) g.recent = g.recent.slice(-40);
    this.save();
  }
  seenAt(iso) {
    if (iso && (!this.data.lastSeenAt || iso > this.data.lastSeenAt)) { this.data.lastSeenAt = iso; this.save(); }
  }
  lastSeen() { return this.data.lastSeenAt ?? null; }
  // De-dupe webhook retries by message id.
  markSeen(id) {
    if (!id) return true;
    if (this.data.seen.includes(id)) return false;
    this.data.seen.push(id);
    if (this.data.seen.length > 2000) this.data.seen = this.data.seen.slice(-2000);
    this.save();
    return true;
  }
  save() {
    const tmp = this.file + ".tmp";
    writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    renameSync(tmp, this.file);
  }
}
