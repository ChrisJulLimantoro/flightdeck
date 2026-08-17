# Flight Deck

Local dual-engine dashboard for PR state + live agent sessions. A NestJS server serving a Svelte SPA,
in one process. Binds to loopback only. No database, no `.env`.

## Setup

### Prerequisites

| | Required? | Why, and what happens without it |
|---|---|---|
| **Node.js 22+** | **yes** | The server needs `require(esm)` to load the agent SDK. Older versions fail at startup. |
| **[GitHub CLI](https://cli.github.com) (`gh`)**, authenticated | **yes** | Every PR query shells out to `gh`. Without it the board shows *"the GitHub CLI (gh) was not found"* and stays empty. |
| **[Claude Code](https://claude.com/claude-code) (`claude`)** | for the Claude engine | Runs agents and lists live sessions. Without it, the Claude engine cannot launch and the sessions strip stays empty. |
| **[Codex CLI](https://developers.openai.com/codex/cli) (`codex`)** | for the Codex engine | Same, for the Codex engine. Without it a launch fails with *"the codex CLI was not found"*. |
| **git** | **yes** | Repo discovery reads `.git/config`; agents run inside your checkouts. |

Everything except Node and `gh` degrades to a clear message rather than an error page — you can run
Flight Deck with only one engine installed, or none, and still use the board.

### Install and run

```bash
corepack enable pnpm     # pnpm is pinned by packageManager; no global install needed
pnpm install
pnpm build               # web → web/dist → server/public, and server → server/dist
pnpm start               # → http://127.0.0.1:4321
```

Then authenticate GitHub if you have not already:

```bash
gh auth login            # needs the `repo` scope to see private PRs
```

Open <http://127.0.0.1:4321>. The board fills in on first load; the first request is slower because
it scans for local checkouts and queries GitHub.

`PORT=5000 pnpm start` moves the port. The server always binds `127.0.0.1` — it holds GitHub tokens
and can spawn agents, so it is never exposed on the network.

### First run: what it touches

| Path | What |
|---|---|
| `~/.flightdeck/auth.json` | Extra GitHub tokens, mode `600`. Created only if you add one. |
| `~/.flightdeck/seen.json` | Per-PR last-seen marks behind the "something changed" dot. |
| `~/.flightdeck/config.json` | Optional. Only needed for the escape hatches below. |
| `$HOME`, 3 levels deep | Read-only scan for git checkouts at startup. Skips dotdirs and `node_modules`. |

Upgrading from a build that used `~/.ai-dashboard`? It is renamed to `~/.flightdeck` automatically on
first start, preserving the `600` mode on `auth.json`.

### Repo discovery

Repos are found with no configuration: Flight Deck walks `$HOME` three levels deep for directories
containing a `.git`, reads each `origin` URL out of `.git/config`, and matches PRs by that remote.
Roughly 40ms for 30-odd repos.

`~/.flightdeck/config.json` exists only for the two cases discovery cannot cover:

```jsonc
{
  // checkouts outside $HOME — a mounted volume, say
  "scanRoots": ["/mnt/work"],
  // an explicit answer for anything the walk still misses; wins over discovery
  "repos": { "OWNER/REPO": "/absolute/path/to/checkout" }
}
```

### Developing

Run Vite alongside the server for hot reload — it proxies `/api` to port 4321:

```bash
pnpm start               # terminal 1
pnpm dev                 # terminal 2 → http://127.0.0.1:5173
```

| Command | |
|---|---|
| `pnpm check` | `tsc` over `shared/` and `server/`, `svelte-check` over `web/` |
| `pnpm build` | build both packages and copy the SPA into `server/public` |
| `pnpm graph` | regenerate [`docs/dependency-graph.md`](docs/dependency-graph.md) |
| `pnpm graph:check` | fail on cycles or a crossed architecture boundary |

### Troubleshooting

**The board is empty and shows a `gh` error.** Run `gh auth status`. A token without the `repo` scope
authenticates fine and then returns nothing for private PRs, so check the scope too.

**Action buttons are greyed out.** The repo is not cloned where discovery can see it. Hover the button
for the reason, then either clone it under `$HOME` or add a `repos` entry to the config.

**Codex runs die with `bwrap: setting up uid map: Permission denied`.** Your kernel blocks
unprivileged user namespaces. See [the Codex sandbox section](#known-environment-issue-the-codex-sandbox).

**Port already in use.** Something else holds 4321 — `PORT=5000 pnpm start`.

## GitHub accounts

Click `@login` under the wordmark to open the accounts modal.

- The **gh keyring** account is always listed and cannot be removed. It is already approved by
  your orgs, so it is the fallback that always works.
- **Add a token** to register another account. It must carry the `repo` scope — a token without
  it authenticates fine and then returns nothing for private PRs, so the dashboard rejects it up
  front and names the missing scope. Classic tokens work; a fine-grained token may need org
  approval before it can see private org repos.
- Switching accounts re-queries GitHub. The PR cache is keyed by login, so one account can never
  serve another's rows.

Tokens live in `~/.flightdeck/auth.json`, mode `600`, and are **never sent to the browser** —
the API returns only login, source, scopes and the last 4 characters.

## What it shows

Two tabs, both open PRs only:

- **MINE** — PRs you opened.
- **REVIEWED BY ME** — PRs you have submitted a review on.

GitHub has no "is the review solved" field, so the state column is derived:

| State | Meaning | Colour |
|---|---|---|
| `CHANGES REQUESTED` | reviewer objected, you have not pushed since | ember |
| `PUSHED SINCE REVIEW` | author pushed after your review — re-review needed | amber |
| `AWAITING REVIEW` | nobody has looked yet | cyan |
| `AWAITING RE-REVIEW` | you pushed, reviewer has not looked again | cyan |
| `IN REVIEW` / `AWAITING AUTHOR` | in flight | cyan |
| `APPROVED` / `SETTLED` | done | lime |

`OPEN` counts review threads that are neither resolved nor outdated. The dot before a title
means something happened since you last opened that row; last-seen timestamps live in
`~/.flightdeck/seen.json`.

Rows sort by urgency: your court first, then unreviewed, then waiting on others.

## Running agents

The `CLAUDE / CODEX` toggle in the masthead picks the engine. Both read skills from the same
directory (`~/.claude/skills` and `~/.codex/skills` are symlinks to one canonical repo), so the
prompt is identical — `/pr-feedback <url>` — on either.

- **FEEDBACK** — `/pr-feedback`, read-only triage of the reviews on that PR.
- **REVIEW** — `/pr-review`, posts review comments. Confirms first.
- **…** — pick any installed skill, or type a free-form prompt.

Output streams into the bottom drawer over SSE. A browser reload re-attaches to the last thread;
the server keeps the full event buffer for the life of the process.

## Controlling a session

The drawer is a two-way surface, not a log viewer.

- **Reply box** — type a follow-up and the same session resumes (Claude `options.resume`, Codex
  `codex exec resume`). It is disabled while a turn is running. This is what lets you answer a
  skill that ends by asking you something.
- **Live tool approval** — tick *ask me before each tool call* in the `…` dialog. Every call the
  agent makes that would normally prompt appears inline with ALLOW / DENY, and the session parks
  until you answer. Unanswered asks auto-deny after 120s so a closed tab can't wedge a run.
  **Claude only** — `codex exec` has no approval channel, so Codex safety comes from the sandbox
  mode chosen at launch.
- **Open sessions started elsewhere** — click any chip in the LIVE SESSIONS strip. The transcript
  replays from disk (`~/.claude/projects/<slug>/<id>.jsonl` or
  `~/.codex/sessions/.../rollout-*.jsonl`) and you can resume from there. A session that is busy
  in another terminal already has a driver, so replies **fork** it into a new branch rather than
  interleaving two.
- **HAND OFF** — copies `cd <cwd> && claude --resume <id>` (or `codex resume <id>`) for when you
  want the real TUI.

Safety modes map per engine:

| Mode | Claude | Codex |
|---|---|---|
| read (default) | `plan` | `read-only` |
| write | `acceptEdits` | `workspace-write` |
| unsandboxed | `acceptEdits` | `danger-full-access` |

Action buttons disable themselves when a PR's repo is not cloned locally, or (on Codex) when
the repo is not a trusted project in `~/.codex/config.toml`.

## Known environment issue: the Codex sandbox

Codex wraps every shell command in `bwrap`, which needs an unprivileged user namespace. Ubuntu 24.04
and other recent distributions block that by default:

```
kernel.apparmor_restrict_unprivileged_userns = 1
```

Where it is blocked, any Codex run that shells out dies with
`bwrap: setting up uid map: Permission denied`. Claude is unaffected. Flight Deck probes for this at
startup, shows a banner on the Codex tab, and translates the raw bwrap error in the log. Two ways out:

```bash
sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0     # persist in /etc/sysctl.d/
```

or tick **RUN UNSANDBOXED** in the `…` dialog, which uses `danger-full-access` and skips bwrap
entirely. That removes Codex's isolation — it is deliberately opt-in per run.

## API

| Route | |
|---|---|
| `GET /api/prs[?fresh]` | both lists, derived and sorted; 60s cache keyed by account |
| `GET /api/agents` | `{claude, codex}` live sessions |
| `GET /api/skills` | installed skills |
| `GET /api/health` | Codex sandbox probe |
| `GET /api/accounts` | `{active, accounts}` — never includes tokens |
| `POST /api/accounts` | `{token}` → validate scopes and register |
| `POST /api/accounts/active` | `{login}` → switch |
| `DELETE /api/accounts/:login` | remove a token account |
| `POST /api/seen` | `{id}` → stamp last-seen |
| `GET /api/threads` | threads this process knows about |
| `POST /api/threads` | `{engine, skill?, prompt?, target?, repo, mode, approvals}` |
| `POST /api/threads/:id/turn` | `{prompt}` → resume the session |
| `POST /api/threads/:id/permission` | `{askId, decision}` → allow/deny a parked tool call |
| `POST /api/threads/:id/stop` | interrupt a turn |
| `POST /api/sessions/:engine/:id/open` | adopt a session started elsewhere |
| `GET /api/stream/:id` | SSE; replays buffered events first |

## Layout

Three pnpm workspaces. `server/` is the publishable package; `shared/` and `web/` are private.

```
shared/          the ThreadEvent union + API types, imported by both sides
web/             Svelte 5 runes SPA (Vite) → web/dist
server/
  src/main.ts    bootstrap; binds 127.0.0.1, migrates ~/.flightdeck, reaps on shutdown
  src/config/    ~/.flightdeck/config.json — scanRoots and repo overrides
  src/github/    gh api graphql, as the active account
  src/accounts/  ~/.flightdeck/auth.json, token validation, switching
  src/prs/       DeriveService (raw PR nodes -> derived state) + the 60s cache
  src/repos/     repo discovery: walk $HOME, match by origin remote
  src/skills/    skill enumeration
  src/agents/    live sessions, both engines
  src/sandbox/   bwrap/userns probe
  src/seen/      ~/.flightdeck/seen.json
  src/transcripts/  on-disk session transcripts -> the same event shape
  src/threads/   registry, approvals, turns, @Sse stream
    drivers/     EngineDriver port — claude.driver.ts, codex.driver.ts
  public/        the built SPA, copied in at build time
```

Adding an engine means writing one `EngineDriver` and listing it in `threads.module.ts`; nothing
else in the thread, approval or SSE path tests engine names.

[`docs/dependency-graph.md`](docs/dependency-graph.md) is the generated module graph.
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) records why it is shaped this way, including the
alternatives that were rejected.

The layering is enforced, not just documented — `pnpm graph:check` fails on a cycle, on `web` and
`server` importing each other, on `shared` depending on either, and on `server` importing a
devDependency at runtime (which would resolve locally and break the published package).

`shared/src/events.ts` is the contract for the SSE feed. Adding a variant there without handling it
in `web/src/lib/transcript.ts` is a compile error, not a silent no-op.
