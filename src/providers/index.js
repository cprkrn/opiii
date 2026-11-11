// A provider turns a webhook body into messages, and sends replies.
// Interface:
//   parseInbound(body) -> Array<{ id, from, text, mediaUrls: string[] }>
//                         (return [] for outbound echoes / status callbacks)
//   send(to, text) -> Promise<void>
//   listen(onBody)  (optional) -> for push providers that deliver messages over a
//                   connection we open (no webhook/public URL needed)
// Add a new provider (LoopMessage, BlueBubbles, Twilio SMS...) by adding a file
// here with those two functions and registering it below.
import * as sendblue from "./sendblue.js";
import * as consoleProvider from "./console.js";
import * as clawmessenger from "./clawmessenger.js";

const providers = { clawmessenger, sendblue, console: consoleProvider };

export function getProvider(name) {
  const p = providers[name];
  if (!p) throw new Error(`Unknown PROVIDER "${name}". Options: ${Object.keys(providers).join(", ")}`);
  return p;
}
