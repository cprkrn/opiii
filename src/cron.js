// Tiny 5-field cron matcher: "min hour day-of-month month day-of-week".
// Supports *, numbers, a-b ranges, lists (1,5,9) and steps (*/15, 0-30/5).
// Times are in the server's TZ (set TZ in .env).
const RANGES = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]];

function parseField(field, [lo, hi]) {
  const set = new Set();
  for (const part of field.split(",")) {
    const [range, stepStr] = part.split("/");
    const step = stepStr ? Number(stepStr) : 1;
    let a, b;
    if (range === "*") [a, b] = [lo, hi];
    else if (range.includes("-")) [a, b] = range.split("-").map(Number);
    else { a = Number(range); b = stepStr ? hi : a; }
    if (![a, b, step].every(Number.isInteger) || step < 1 || a < lo || b > hi || a > b)
      throw new Error(`bad cron field "${field}"`);
    for (let v = a; v <= b; v += step) set.add(v === 7 && hi === 6 ? 0 : v);
  }
  return set;
}

export function parseCron(expr) {
  const f = String(expr).trim().split(/\s+/);
  if (f.length !== 5) throw new Error(`cron needs 5 fields, got "${expr}"`);
  const sets = f.map((x, i) => parseField(x.replace(/^7$/, "0"), RANGES[i]));
  return { sets, domStar: f[2] === "*", dowStar: f[4] === "*" };
}

export function cronMatches(expr, d = new Date()) {
  const { sets, domStar, dowStar } = typeof expr === "string" ? parseCron(expr) : expr;
  const [min, hour, dom, mon, dow] = sets;
  if (!min.has(d.getMinutes()) || !hour.has(d.getHours()) || !mon.has(d.getMonth() + 1)) return false;
  const domOk = dom.has(d.getDate()), dowOk = dow.has(d.getDay());
  // Standard cron: if both day fields are restricted, either may match.
  if (!domStar && !dowStar) return domOk || dowOk;
  return domOk && dowOk;
}

// Minutes between runs over the next 2 days, used to warn about very frequent jobs.
export function minGapMinutes(expr) {
  const p = parseCron(expr);
  let last = null, gap = Infinity;
  const t = new Date(); t.setSeconds(0, 0);
  for (let i = 0; i < 2 * 24 * 60; i++, t.setMinutes(t.getMinutes() + 1)) {
    if (cronMatches(p, t)) { if (last !== null) gap = Math.min(gap, i - last); last = i; }
  }
  return gap;
}
