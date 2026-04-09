<!--
README for Claude Station.
Remember to replace `yashdesai` with your actual GitHub handle if it is different before publishing.
-->

# Claude Station

**A local dashboard for every Claude Code session on your machine.** Browse projects, search transcripts, see token usage broken down honestly, spawn and control terminals from the browser, and take over runaway `claude` processes you started in other windows — all from one localhost React app.

[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![node: 20+](https://img.shields.io/badge/node-20%2B-brightgreen.svg)](https://nodejs.org)
[![status: active](https://img.shields.io/badge/status-active-success.svg)](#roadmap)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-orange.svg)](#contributing)
[![collaborators wanted](https://img.shields.io/badge/collaborators-wanted-purple.svg)](#looking-for-collaborators)

---

> ## Looking for collaborators
>
> Claude Station is an early-stage open source project and I am actively looking for co-maintainers and contributors to take it further. If you use Claude Code heavily, if you like building developer tools, or if you want a real project to cut your teeth on local-first full-stack TypeScript, this is for you.
>
> Good first places to jump in are listed in the [Contributing](#contributing) section and in the [GitHub issues](https://github.com/yashdesai/claude-station/issues) once the repo is live. Open a PR, open an issue, or just reach out — I would rather this become a community project than a one-person repo, and I am happy to hand out commit rights to anyone who lands two or three solid PRs.

---

## The problem

If you use Claude Code as heavily as I do, you end up with this:

- Five terminal windows open across five projects, each running its own `claude` instance.
- No idea which session was the one you used yesterday to debug that thing.
- No idea how much of the "millions of tokens" the assistant reports you actually consumed, versus cheap cache replay.
- One of them is stuck waiting on a tool call that never resolved, but you cannot remember which.
- You want to close your laptop and forget about it, except there is almost certainly a `claude --resume` session you should be continuing.

Claude Code already stores everything you need to answer those questions on disk, in `~/.claude/projects/<slug>/<uuid>.jsonl`. It just does not give you a UI over that data. Claude Station is that UI.

## What it does

- **Lists every project and session on your machine.** Reads the JSONL transcripts Claude Code writes locally. No API key, no network calls, no telemetry.
- **Live session filter.** A one-click toggle to show only sessions whose JSONL has been written to in the last 60 seconds. Instantly see what is actually active versus stale history.
- **Running-process scanner.** Scans `ps` and `lsof` every few seconds to find every external `claude` process you have running, resolves each PID to its project and current session, and displays them in a dashboard panel with start times and live indicators.
- **Take over external sessions.** Pick a `claude` running in a terminal window you opened hours ago, click Take over, and Claude Station will SIGTERM the external process, spawn an embedded PTY in the same working directory, and run `claude --resume <session>` so you can keep the same conversation in a browser tab. Your history is preserved because it lives in the JSONL, not the process.
- **Embedded terminal.** Real PTYs via `node-pty` streamed over WebSockets to an `xterm.js` frontend. Spawn new shells, resume sessions, kill them — same as a native terminal, but attached to the same UI that shows your other data.
- **Honest token accounting.** The dashboard breaks token usage into input, output, cache-create, and cache-read with explanations of what each one actually costs. Most tools show a single fat number that makes you think you burned tens of millions of tokens when 90 percent of it is Anthropic's prompt-cache replay, billed at around 10 percent of fresh input. This tool tells you the truth.
- **Per-day trend chart.** Exact per-event bucketing, not session-level approximation. Bars are stacked by token type so you can see at a glance that the green sliver on top (output) is the real work, and the grey bottom (cache read) is the cheap context replay.
- **Top projects by output tokens.** "Which project has Claude actually done the most work on" answered honestly.
- **Transcript viewer.** Full rendered conversation view per session with user and assistant messages, collapsed tool calls, markdown, and code blocks. Navigate to any historical session in two clicks.
- **Collapsible project list.** Active projects (last 7 days or currently running) stay on top. Stale projects fold into a single "Older (N)" expander that remembers its state in `localStorage`.

## Screenshots

_Coming soon — add your own and send a PR._

```
docs/
  screenshots/
    dashboard.png
    terminal.png
    session.png
    token-breakdown.png
```

## Quick start

Requires Node 20 or later. Runs on macOS and Linux today (Windows support is PR-welcome).

```bash
git clone https://github.com/yashdesai/claude-station.git
cd claude-station
npm install
npm run dev
```

Then open <http://127.0.0.1:5173>.

That is the whole install. No database, no build step before first run, no environment variables, no config files.

- Frontend runs on `127.0.0.1:5173` (Vite).
- Backend runs on `127.0.0.1:5174` (Express + WebSocket).
- Both are bound to localhost only. Do not change that.

## Why you should try it

- You already have all this data sitting on disk. You should be able to look at it.
- You have probably been misreading your token usage. Your actual output is a fraction of what Claude Code's default totals suggest.
- You will find a stuck `claude` process you forgot about. Almost everyone does, the first time they run it.
- It takes two minutes to install and cleans up after itself.

## The token breakdown, explained

This was the feature that surprised me most while building the tool, and it is probably the most useful thing it surfaces.

Every assistant turn emits a `usage` block with four counters:

| Field | What it actually is | How Anthropic bills it |
|---|---|---|
| `input_tokens` | Fresh tokens you sent that were not in the prompt cache | Full rate |
| `output_tokens` | Tokens Claude generated in its response | Full rate (highest) |
| `cache_creation_input_tokens` | First-time context priming that gets stored in the cache | ~125 percent of input |
| `cache_read_input_tokens` | The cached context being replayed on every subsequent turn | ~10 percent of input |

When you naively sum those four numbers, you get a big scary total. On my machine, across 54 sessions, the total is 678 million tokens. But that is not 678 million tokens worth of work. It is:

- 2.45 million output (0.4 percent of the total)
- 137 thousand input (0.02 percent)
- 43.9 million cache create (6.5 percent)
- **632.2 million cache read (93 percent)**

The cache read number is huge because every time Claude responds in a 50-turn conversation with a 100k-token context, Anthropic reports "I replayed the 100k cached tokens again" as 100k additional "tokens used." Over 50 turns you accumulate 5 million cache reads for a single conversation. Billed against cache-read pricing, this is cheap. Displayed as a single total, it is misleading.

Claude Station's dashboard defaults to showing output tokens as the headline metric, stacks the daily chart by type so cache reads are visually de-emphasized, and includes a "token breakdown" card that explains each counter in plain English. I have not seen another tool do this, and it is the single most useful thing the app has taught me about how I actually use Claude.

## Architecture

```
claude-station/
  server/               Express + tsx backend. 127.0.0.1:5174 only.
    src/
      index.ts           API routes + WebSocket upgrade
      claude-data.ts     Streams ~/.claude/projects JSONL files
      usage-aggregator.ts  Per-file mtime cache + exact daily bucketing
      process-scan.ts    ps + lsof scanner with PID to session disambiguation
      pty-manager.ts     node-pty instances + per-PTY random tokens
      ws.ts              WebSocket handler for terminal streams
      types.ts           Shared API response shapes
  src/                  Vite + React frontend. 127.0.0.1:5173.
    pages/              HomeView, ProjectView, SessionView, TerminalView
    components/         Sidebar + shadcn/ui primitives
    hooks/              React Query data hooks
  scripts/
    fix-node-pty-perms.mjs  postinstall chmod for node-pty spawn-helper
  package.json          One npm run dev boots both halves via concurrently
```

### Design decisions worth mentioning

- **No database.** Everything is streamed from the JSONL files on demand with an mtime-keyed in-memory cache. First call parses ~20MB across 50-ish sessions in around 400ms. Subsequent calls are ~15ms because unchanged files are not re-read. When the session count outgrows this, SQLite + FTS5 is the planned upgrade path, but so far it has not been necessary.
- **PID to session mapping is a heuristic.** Claude Code does not expose a reverse mapping from process to JSONL. Claude Station uses `ps -o etime=` to get each process's start time and `stat` to get each JSONL's birth time, then pairs them greedily (newest PID first) by picking the session whose birth is closest to the PID's start, filtered to sessions modified during the PID's lifetime. This correctly disambiguates multiple `claude` processes sharing a working directory most of the time.
- **"Take over" is three steps, not an attach.** You cannot attach to another terminal's TTY. What you can do is kill the external process, wait for file locks to release, and spawn a new `claude --resume` in an embedded PTY. Same conversation state, new process, now controllable from the UI.
- **Tokens are authoritative, billing is an estimate.** The token counts come straight from Anthropic's `usage` blocks in the JSONL, so they are exactly what would be billed. A dollar-denominated estimate is on the roadmap but requires model-aware pricing since Opus, Sonnet, and Haiku have different rates.

### API reference

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Service check |
| GET | `/api/projects` | List every project under `~/.claude/projects/` with accurate paths (resolved from JSONL `cwd` fields) |
| GET | `/api/projects/:slug/sessions` | List sessions in a project with titles, token totals, live flags |
| GET | `/api/projects/:slug/sessions/:id` | Full parsed transcript for a session |
| GET | `/api/terminals` | List active embedded PTYs |
| POST | `/api/terminals` | Spawn a new PTY with optional cwd, command, args. Returns `{id, token}` |
| DELETE | `/api/terminals/:id` | SIGHUP a PTY |
| WS | `/ws/terminal?id=...&token=...` | Bidirectional PTY stream |
| GET | `/api/processes` | Every external `claude` process with cwd, project mapping, inferred current session, start time |
| POST | `/api/processes/:pid/kill` | SIGTERM an external process (guarded to PIDs the scanner has already flagged as `claude`) |
| GET | `/api/usage?days=14` | Aggregated token usage with per-project and per-day breakdowns |

## Security

This is a local tool. Do not expose it to the network.

- The backend binds to `127.0.0.1` only. The Vite proxy and CORS allowlist only `http://127.0.0.1:5173`.
- Embedded terminals run under your user account with full shell privileges. WebSocket upgrades check the `Origin` header, and each PTY gets a random 48-character token that must be presented to attach. Tokens live in memory and are cleared on PTY exit.
- The `/api/processes/:pid/kill` endpoint can only target PIDs the scanner has already flagged as `claude`. It cannot be turned into a general-purpose kill-any-PID hole.
- There is no authentication layer. Localhost is the trust boundary.
- Do not port-forward this over SSH. Do not run it inside a shared VM without firewalling ports 5173 and 5174. If you need remote access, put the whole thing behind a tunnel like Tailscale and keep the app bound to `127.0.0.1` on the other side.

## Roadmap

- [ ] Live transcript tailing via Server-Sent Events and `chokidar` file watch, so you can watch another `claude` instance's output grow in real time from the browser.
- [ ] Global transcript search (naive grep for the first pass, SQLite FTS5 after).
- [ ] USD cost estimate with model-aware pricing (Opus, Sonnet, Haiku).
- [ ] Session export (Markdown, JSON) and bulk operations.
- [ ] Cross-platform process detection on Windows via `wmic` or PowerShell.
- [ ] Optional Tauri packaging for a native app icon and better OS integration.
- [ ] Multi-tab terminal groups with layout persistence.
- [ ] Keyboard shortcuts and a command palette.

## Comparisons

**Why not tmux, Warp, or a regular terminal multiplexer?**
Those solve "I want many terminals in one window." Claude Station solves "I want to see every Claude Code session across every project, including ones running outside this tool, with metadata about what they are doing and what they have cost me." It complements your normal terminal setup. You will still use tmux or Warp for day-to-day shell work.

**Why not just read the JSONL files yourself?**
You can. I did. After about a week I realized I was building the same ad-hoc scripts every couple of days and decided to formalize them.

**Why not use an API-based dashboard?**
The Claude Code JSONL format contains everything the API would give you plus the full local context (cwd, git branch, tool calls, your own prompts). You do not need an API key, you do not send data to any server, and it works offline.

## Contributing

**Collaborators wanted.** This project has a lot of surface area and I would much rather build it with other people than alone. Whether you want to ship one small fix or co-maintain the repo, you are welcome here.

### Good first issues

- **Windows process scanning.** The current scanner shells out to `ps` and `lsof`, so it returns empty on Windows. A `wmic` or PowerShell branch would unlock Windows users in one PR.
- **Screenshots for the README.** None of the screenshots above exist yet. Run the app, take four nice shots (dashboard, terminal, session, token breakdown), and send a PR to `docs/screenshots/`.
- **Additional JSONL event schemas.** Claude Code has evolved its format a few times. If you find an event shape this tool does not handle, open an issue with the (anonymized) offending line and the version of Claude Code that produced it, or submit the parser fix directly.
- **USD cost estimator.** Per-message pricing by model (Opus, Sonnet, Haiku), surfaced as a "billable equivalent" stat card on the dashboard. The token counts are already there.
- **Keyboard shortcuts and a command palette.** Cmd+K to open any session, Cmd+T to spawn a terminal, etc.

### Bigger things

- **Live transcript tailing.** Server-Sent Events plus a `chokidar` file watcher so the session view updates in real time while another `claude` is writing to disk. This is the payoff of having both halves of the app (process detection and transcript rendering) in one place.
- **Global transcript search.** Start with naive grep, promote to SQLite FTS5 when it gets slow.
- **Tauri packaging.** Native app icon, OS integration, packaged binaries for release.
- **Multi-tab terminal groups** with persistence so a reload restores your layout.

### Ground rules

- Small, focused PRs. One thing at a time.
- TypeScript everywhere. No `any` in new code without a good reason.
- Do not break localhost-only binding or the `Origin` check on WebSocket upgrade. This tool spawns shells; those boundaries are the security model.
- If you land two or three substantive PRs, I will give you commit access without being asked.

### How to reach me

- Open an issue on the repo.
- Open a draft PR even if it is incomplete — I would rather see work in progress than perfect code.
- Or find me on LinkedIn and send a message.

## Troubleshooting

**`posix_spawnp failed` the first time you try to spawn a terminal.**
This is a known `node-pty` tarball issue: the prebuilt `spawn-helper` binary sometimes loses its executable bit. Claude Station runs `scripts/fix-node-pty-perms.mjs` as a postinstall to `chmod +x` it automatically. If you skipped postinstall, run it manually: `node scripts/fix-node-pty-perms.mjs`.

**The daily token chart shows everything on one day.**
You are probably on an older build. Upgrade to v0.4 or later, which uses per-event timestamps for exact daily bucketing.

**The dashboard says 328 million tokens and I am pretty sure I did not use that many.**
You did not. Read the [token breakdown section](#the-token-breakdown-explained) above. That number is input plus output plus cache create plus cache read, and the last one is 90 percent of the total and billed at 10 percent of the rate.

## License

MIT. See [LICENSE](./LICENSE).

## Acknowledgements

This project was built end-to-end in a Claude Code session. Fitting, given what it is for.
