// Sendblue iMessage API. Docs: https://docs.sendblue.com
// Send:    POST https://api.sendblue.co/api/send-message
//          headers sb-api-key-id / sb-api-secret-key, body { number, from_number, content }
// Receive: Sendblue POSTs inbound messages to your webhook URL.
import { config, normalizeNumber } from "../config.js";

const SEND_URL = "https://api.sendblue.co/api/send-message";

export function parseInbound(body) {
  if (!body || typeof body !== "object") return [];
  // Sendblue also posts outbound status updates. Ignore anything we sent.
  if (body.is_outbound === true || body.isOutbound === true) return [];
  // Field names vary across Sendblue API versions, so accept the known spellings.
  const from = normalizeNumber(body.from_number ?? body.fromNumber ?? body.number);
  const text = String(body.content ?? body.text ?? "").trim();
  const media = body.media_url ?? body.mediaUrl;
  const mediaUrls = media ? [].concat(media).filter(Boolean) : [];
  if (!from || (!text && mediaUrls.length === 0)) return [];
  return [{ id: body.message_handle ?? body.messageHandle ?? null, from, text, mediaUrls }];
}

export async function send(to, text) {
  const res = await fetch(SEND_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "sb-api-key-id": config.sendblue.apiKeyId,
      "sb-api-secret-key": config.sendblue.apiSecretKey,
    },
    body: JSON.stringify({
      number: to,
      content: text,
      ...(config.sendblue.fromNumber ? { from_number: config.sendblue.fromNumber } : {}),
    }),
  });
  if (!res.ok) {
    throw new Error(`Sendblue send failed: ${res.status} ${await res.text().catch(() => "")}`);
  }
}
