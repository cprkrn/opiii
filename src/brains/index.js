// A brain turns (message, previous session) into (reply, new session).
// Interface:
//   reply({ text, sessionId }) -> Promise<{ text, sessionId }>
//   throw SessionLostError if sessionId can't be resumed (we retry fresh).
import * as claudeCli from "./claude-cli.js";

const brains = { "claude-cli": claudeCli };

export function getBrain(name) {
  const b = brains[name];
  if (!b) throw new Error(`Unknown BRAIN "${name}". Options: ${Object.keys(brains).join(", ")}`);
  return b;
}
