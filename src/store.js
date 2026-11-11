// Minimal JSON-file store: maps a phone number to its Claude Code session id.
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { join } from "node:path";

export class Store {
  constructor(dir) {
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, "state.json");
    this.data = existsSync(this.file)
      ? JSON.parse(readFileSync(this.file, "utf8"))
      : { users: {}, seen: [] };
    this.data.groups ??= {};
  }
  user(number) {
    return (this.data.users[number] ??= { sessionId: null, messages: 0 });
  }
  update(number, patch) {
    Object.assign(this.user(number), patch);
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
  // De-dupe webhook retries by message id.
  markSeen(id) {
    if (!id) return true;
    if (this.data.seen.includes(id)) return false;
    this.data.seen.push(id);
    if (this.data.seen.length > 500) this.data.seen = this.data.seen.slice(-500);
    this.save();
    return true;
  }
  save() {
    const tmp = this.file + ".tmp";
    writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    renameSync(tmp, this.file);
  }
}
