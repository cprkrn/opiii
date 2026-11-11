# iMessage Claude

Text your own Claude from your iPhone, in your normal Messages app, and have it **write code** too.

- **Runs on your Claude subscription** (Pro/Max) through the official Claude Code CLI. No API key or per-token bill.
- **Two modes:** `chat` (a texting-style assistant with web search) and `/code` (full Claude Code: clones your repos, edits files, runs tests, commits, pushes).
- **Model:** Claude Opus 5.5 by default (`CLAUDE_MODEL`).
- **Zero npm dependencies.** Runs on your own computer or any Linux box. No public URL needed.
- **Composable:** iMessage providers live in `src/providers/` and "brains" in `src/brains/`. Each is a small interface, so you can swap or add one.

> **Personal use only.** Anthropic's terms allow your own subscription to power *your own* use of Claude Code. Don't share the number with other people or sell access. That has to go through the API with an API key. The bot only replies to `OWNER_NUMBER` (your phone and/or Apple ID email) and ignores everyone else.

## How it works

```
Your iPhone ──iMessage (blue)──▶ Claw Messenger ──WebSocket──▶ this bot ──▶ `claude -p` on your subscription
     ▲                                                              │
     └─────────────────── reply (Claw API) ◀────────────────────────┘
```

- [Claw Messenger](https://clawmessenger.com) runs the Apple hardware and gives you an iMessage number you text from your normal Messages app. Bubbles are blue.
- The bot opens a connection *out* to Claw, so **you don't need a public URL, domain, tunnel or open ports**. It works behind home Wi-Fi.
- Each text runs `claude -p --resume <session>`, so it remembers the conversation.

## What it costs

| Thing | Monthly | Notes |
|---|---|---|
| Claude Pro or Max | $20 / $100 | You probably already pay this. Texts use the same limits as Claude and Claude Code. Opus 5.5 and long coding tasks use them fastest. |
| Claw Messenger Base | **$5** | 1,000 messages/mo, counting **sent and received**. 7-day free trial. Plus: $25 for 6,000. |
| Hosting | **$0–6** | $0 on a computer you leave on; $6 for a DigitalOcean droplet (1 GB) that's always on. |
| **Extra on top of Claude** | **$5–11** | |

1,000 messages is about 15 back-and-forths a day. Long replies are split into ~1,500-character texts, and `/code` sends an extra "On it" message, so each of those counts too.

Prices are from public sources (Nov 2026). Check them before you buy.

## Setup (about 15 minutes)

**1. Get Claw Messenger.** Sign up at clawmessenger.com and start the trial. In the dashboard:
- copy your **API key** (`cm_live_...`)
- **register your own phone number** (and your Apple ID email, if your iPhone sends iMessages from it). Claw drops texts from unregistered senders.
- note the **number to text**. On the base plan this may be a shared Claw number; Claw routes your texts to your bot because your phone is registered.

**2. Get a machine.** Use your Mac/Linux computer (or Windows with WSL), or a DigitalOcean droplet ($6, Ubuntu, 1 GB):
```bash
# on a fresh Ubuntu droplet
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs git
```

**3. Download and run setup:**
```bash
git clone <this repo> imessage-claude && cd imessage-claude
./scripts/setup.sh
```
It asks for your phone number, Claw key and an optional GitHub token, then runs `claude setup-token`. Open the link it prints, sign in with your Claude account, and paste the token back.

**4. Start it.** Pick one:
```bash
npm start                      # simple, runs while the terminal is open
```
```bash
docker compose up -d --build   # always on, restarts itself (install Docker first)
```
You should see `Claw Messenger connected`.

**5. Text the Claw number from your iPhone.** 💙

## Using it

| Text | What happens |
|---|---|
| anything | Chat with your assistant |
| `/code` | Coding mode: full Claude Code, working in `data/projects/` |
| `/code clone github.com/me/app and fix the failing tests` | Switch to coding mode and start the task right away |
| `continue` | Keep going if it hit its step limit |
| `/chat` | Back to chat mode (each mode keeps its own memory) |
| `/new` | Start a fresh conversation in the current mode |
| `/status`, `/help` | Show the current mode or the command list |
| "text me if BTC drops 5%, check hourly" | Creates a **scheduled job** that runs on its own and texts you (alerts, reminders, daily briefings). "what jobs do I have?" and "cancel the BTC job" manage them. Minimum interval is 15 min. |

**Coding notes**
- Add a fine-grained `GITHUB_TOKEN` (limited to the repos you want) so it can clone, push and open PRs.
- `CLAUDE_CODE_PERMISSION_MODE=auto` lets a safety classifier approve each action, since nobody can tap "allow" over text. If your plan doesn't support auto mode, set `bypassPermissions`, but only inside Docker or another sandbox.
- Long tasks can take minutes. You'll get "On it 👨‍💻" right away and a summary when it's done (timeout `CLAUDE_CODE_TIMEOUT_MINUTES`, default 20).

**Customize** the personality in `persona.md`. Text `/new` afterwards so it takes effect.

## Group chats

Add the bot's number to a group (needs Claw **Growth** or higher, since groups need 2+ registered numbers). It reads the conversation for context but **only replies when you** start a message with `claude`, e.g. `claude what time is dinner?`. Friends can't trigger it, so they never spend your Claude plan. Each group has its own memory. `claude /new` resets it. Settings: `GROUPS=0` turns groups off; `GROUP_TRIGGER=jarvis` changes the wake word.

## Updating

On the server, run `sudo imessage-claude-update`. It pulls the latest code from your GitHub repo and restarts the bot. The first time, it asks for a read-only GitHub token. Your `.env` and `data/` are kept.

## Troubleshooting

- **No reply:** run with `LOG_WEBHOOKS=1` to print every incoming event. If nothing shows up, your phone or email isn't registered in the Claw dashboard.
- **"ignored message from non-owner X":** add X to `OWNER_NUMBER`. It's often your Apple ID email.
- **"Claw socket connection failed… check CLAW_API_KEY":** the key is wrong or revoked. Copy it again from the dashboard.
- **Hit the message cap:** Claw rejects sends until next month. Upgrade the plan or wait.
- **Login errors:** re-run `claude setup-token` and update `CLAUDE_CODE_OAUTH_TOKEN` (it lasts about a year). Make sure `ANTHROPIC_API_KEY` is **not** set.
- **Test without a phone or Claw account:** run the fake Claw server and point the bot at it:
  ```bash
  node test/mock-claw.mjs 4001 &
  CLAW_BASE_URL=http://localhost:4001 CLAW_API_KEY=cm_live_test npm start
  curl -XPOST localhost:4001/inject -d '{"from":"YOUR_NUMBER","text":"hi"}'
  ```

## Extending

- **Providers included:** `clawmessenger` (default), `sendblue` (webhook based, about $100/mo), and `console` (local testing).
- **New provider** (BlueBubbles on an old Mac, LoopMessage, Telegram…): add `src/providers/<name>.js` exporting `parseInbound(body)`, `send(to, text)` and optionally `listen(onEvent)` for socket-based services. Register it in `src/providers/index.js`.
- **New brain:** add `src/brains/<name>.js` exporting `reply({ text, sessionId, mode })`. One that uses the Anthropic API with an API key is what you'd use to serve *other* people legitimately.

Run tests with `npm test`.
