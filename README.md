# Flight Deck

Local dual-engine dashboard for PR state + live agent sessions. One Node process, no build step.

```bash
npm install
npm start          # → http://127.0.0.1:4321
```

Binds to loopback only. No database, no `.env`. GitHub access uses your existing `gh` keyring
login by default.

## GitHub accounts

Click `@login` under the wordmark to open the accounts modal.

- The **gh keyring** account is always listed and cannot be removed. It is already approved by
  your orgs, so it is the fallback that always works.
- **Add a token** to register another account. It must carry the `repo` scope — a token without
  it authenticates fine and then returns nothing for private PRs, so the dashboard rejects it up
  front and names the missing scope. Classic tokens work; a fine-grained token may need org
  approval before it can see `GDP-ADMIN` repos.
- Switching accounts re-queries GitHub. The PR cache is keyed by login, so one account can never
  serve another's rows.

Tokens live in `~/.ai-dashboard/auth.json`, mode `600`, and are **never sent to the browser** —
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
`~/.ai-dashboard/seen.json`.

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

Codex wraps every shell command in `bwrap`, which needs an unprivileged user namespace. On this
machine that is blocked:

```
kernel.apparmor_restrict_unprivileged_userns = 1
```

so any Codex run that shells out dies with `bwrap: setting up uid map: Permission denied`.
Claude is unaffected. The dashboard probes for this at startup, shows a banner on the Codex tab,
and translates the raw bwrap error in the log. Two ways out:

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

```
server.js        routes + SSE hub
lib/github.js    gh api graphql, as the active account
lib/accounts.js  ~/.ai-dashboard/auth.json, token validation, switching
lib/derive.js    raw PR nodes -> derived state
lib/repos.js     repo slug -> local path, via git remotes
lib/skills.js    skill enumeration
lib/agents.js    live sessions, both engines
lib/engine.js    threads and turns (claude-agent-sdk | codex exec --json), tool approvals
lib/transcript.js  on-disk session transcripts -> the same event shape
lib/sandbox.js   bwrap/userns probe
lib/seen.js      ~/.ai-dashboard/seen.json
public/          index.html + style.css + app.js
```
