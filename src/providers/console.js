// Local testing provider: POST {"from": "+1555...", "text": "hi"} to the webhook,
// and replies are printed to the server log instead of being texted.
import { normalizeNumber } from "../config.js";

export function parseInbound(body) {
  const from = normalizeNumber(body?.from);
  const text = String(body?.text ?? "").trim();
  if (!from || !text) return [];
  return [{ id: body.id ?? null, from, text, mediaUrls: [] }];
}

export const sent = [];
export async function send(to, text) {
  sent.push({ to, text });
  console.log(`\n📱 reply to ${to}:\n${text}\n`);
}
