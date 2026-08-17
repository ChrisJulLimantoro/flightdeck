# Flight Deck — Architecture

Target architecture and the reasoning behind it. The code in this repo is currently the
**pre-migration** state: plain Node + Express + vanilla DOM, no build step. This document records
where it is going and, more importantly, why the alternatives were rejected.

## Decisions

| Layer | Decision |
|---|---|
| Backend | **NestJS + TypeScript**, Model-Service-Controller |
| Frontend | **Svelte 5 runes + Vite SPA** (not SvelteKit, not stores) |
| Shared | **One TypeScript package for the event union**, imported by both sides |
| Repo discovery | `~/.flightdeck/config.json` + first-run prompt |
| Distribution | npm package, `npx flightdeck` |
| Durability (later) | SQLite via `better-sqlite3`, not Redis |

## A backend is a hard constraint

Worth stating first, because it bounds every other choice:

- `@anthropic-ai/claude-agent-sdk` **spawns processes**. Browsers cannot. Same for `codex`, `gh`,
  and `git`.
- Session transcripts require filesystem reads of `~/.claude/projects/*.jsonl`.
- The guarantee that tokens live in `auth.json` mode `600` and are **never sent to the browser** is
  only enforceable server-side. Calling GitHub from the browser would both expose the token and
  hit CORS.
- The tool-approval flow needs a process that outlives the tab, so a closed tab cannot wedge a run.

The only genuine alternative is Electron/Tauri, which bundles the same backend with the UI and
costs `npx flightdeck`. Not worth it.

## What NestJS actually buys

Nest gives **no runtime speedup**. Its value is structural:

- **DI → testability.** Services take their adapters as constructor params, so `ThreadRegistry` can
  be tested against a fake `EngineDriver` with no child processes at all. Today's module-global
  `Map` (`lib/engine.js:8`) cannot be tested without spawning real agents.
- **Lifecycle hooks.** `OnApplicationShutdown` reaps spawned `codex` children on exit — a real leak
  the current code has.
- **Validation pipes** replace the hand-rolled guards in `server.js:106-141`.
- **Module boundaries** that hold as subsystems accumulate.

Nest provider singletons live for the application lifetime, so the shared-memory property the
approval flow depends on (`lib/engine.js:43-67`) is preserved. That is precisely why Nest works
where Next.js does not.

Its startup cost (~300 ms: `reflect-metadata` evaluation, eager provider instantiation, module
loading) is irrelevant here — Flight Deck is a long-lived daemon started once and left running.
Startup latency matters for per-command CLIs, not servers.

## Structure: Model-Service-Controller

- **Controller** — HTTP surface, DTO validation, no logic.
- **Service** — the logic; injectable and unit-testable.
- **Model** — with no database yet, TypeScript types and DTOs in `shared/`, not ORM entities. These
  become real entities when SQLite arrives.

Layer *one* port beneath the services, only where two interchangeable implementations genuinely
exist — the engines. This is what lets the **Codex placeholder** ship as a stub and be swapped
later without touching thread, approval, or SSE logic:

```ts
// src/threads/drivers/engine-driver.port.ts
export interface EngineDriver {
  readonly engine: EngineName;
  run(ctx: TurnContext, prompt: string): Promise<void>;  // emits via ctx.emit
  stop(ctx: TurnContext): void;
  supportsApprovals: boolean;                            // true: claude, false: codex
}
export const ENGINE_DRIVERS = Symbol('ENGINE_DRIVERS');
```

`supportsApprovals` replaces the scattered `engine === "claude"` checks in `lib/engine.js:180` and
`server.js`.

### Backend tree

```
src/
  main.ts                      bootstrap, binds 127.0.0.1
  app.module.ts
  config/                      ~/.flightdeck/config.json, schema, first-run state
  github/                      GithubAdapter (gh CLI), AccountsService
  prs/                         PrsController, DeriveService (pure — the unit-test target)
  repos/                       ReposAdapter (git remote scan)
  skills/  agents/             SkillsService, AgentsService
  files/                       FilesController — `@` completion, git ls-files, traversal guard
  diff/                        DiffController — git diff / gh pr diff, parsed into hunks
  transcripts/                 TranscriptAdapter (jsonl -> events)
  threads/
    threads.controller.ts      REST surface
    thread-registry.service.ts the Map, as an injectable singleton
    turn.service.ts            startTurn orchestration
    approval.service.ts        park/resolve, the 120s auto-deny
    events.gateway.ts          @Sse() -> Observable
    drivers/
      engine-driver.port.ts
      claude.driver.ts         in-process SDK query()
      codex.driver.ts          STUB for now
shared/
  events.ts                    the discriminated union — imported by BOTH sides
```

`lib/derive.js` (78 lines, pure functions) becomes `DeriveService` — the highest-value unit test in
the codebase: all the PR state logic, no I/O.

## The shared event union

`lib/engine.js` produces `{t: "text" | "tool" | "ask" | "verdict" | "session" | "result" | "error"
| "think" | "stderr" | "user" | "turn" | "status"}` and `public/app.js` consumes it with **no
contract between them**. Typing it once and importing on both sides makes a new event variant a
compile error in the frontend switch rather than a silent no-op.

```ts
export type ThreadEvent =
  | { t: 'text';    body: string }
  | { t: 'ask';     askId: string; tool: string; body: string }
  | { t: 'verdict'; askId: string; body: 'allow' | 'deny' | 'timeout' }
  | ...;
```

Wire it as an npm workspace so both packages import it by name. This is the single highest-value
piece of the TypeScript migration.

## Frontend: Svelte 5 runes

Svelte 5 uses **runes** (`$state`, `$derived`, `$effect`); `writable()` stores are the Svelte 4
idiom. Shared reactive state lives in `.svelte.ts` modules, which is TypeScript-native.

**Plain Svelte + Vite, not SvelteKit.** SvelteKit brings its own server, routing, and SSR; Nest is
already the server and this is one local screen. Build an SPA to static assets and serve them with
`@nestjs/serve-static`. SvelteKit would mean two servers arguing.

```
web/src/
  lib/
    state/
      threads.svelte.ts     class ThreadStore { events = $state<ThreadEvent[]>([]) }
      prs.svelte.ts
      accounts.svelte.ts
    api/client.ts           typed fetch, returns shared/ types
    api/stream.ts           EventSource -> ThreadEvent, reconnect handling
  components/
    board/PrRow.svelte  StateBadge.svelte
    drawer/Transcript.svelte  ApprovalPrompt.svelte  ReplyBox.svelte
    completion/Autocomplete.svelte    one component; `@` files + `/` skills
    diff/DiffView.svelte  Hunk.svelte
    accounts/AccountsModal.svelte
  App.svelte
```

The idiomatic pattern for the stream is a class with `$state` fields, instantiated per thread:

```ts
// threads.svelte.ts
export class ThreadStore {
  events = $state<ThreadEvent[]>([]);
  status = $state<ThreadStatus>('idle');
  pendingAsk = $derived(this.events.findLast(e => e.t === 'ask' && !this.answered.has(e.askId)));
  append(event: ThreadEvent) { this.events.push(event); }
}
```

`pendingAsk` as `$derived` is the structural improvement over the current code: today the approval
prompt is imperatively created and torn down in `public/app.js:271-290`. As derived state it simply
follows the event list and cannot desynchronise from it.

Keep the transcript append-only and key the `{#each}` by event index — Svelte 5 compiles to
fine-grained updates, so appending stays O(1) per event.

## Planned features

Each adds backend surface, and two of them are the same component.

### `@` file selector and `/` skill picker are one feature

Both are caret-triggered autocomplete in the reply box; only the candidate source differs. Build a
single `Autocomplete.svelte` with a `CompletionProvider` interface and supply two providers.
Building them twice is the mistake to avoid.

```ts
interface CompletionProvider {
  trigger: '@' | '/';
  search(query: string, ctx: { repo: string }): Promise<Completion[]>;
}
```

`/` already has its data source — `GET /api/skills` (`lib/skills.js`) — so the skill picker is
mostly a UI change from the current `…` dialog.

`@` needs a new `FilesController` + `FilesService`:

- `GET /api/repos/:slug/files?q=` — use **`git ls-files`** rather than walking the tree. It is
  instant and already respects `.gitignore`, so `node_modules` is never offered as a completion.
- **A path-traversal guard is mandatory.** Resolve every requested path and assert it stays inside
  the repo root from `ReposService`. This endpoint takes user input and reads the filesystem;
  `../../.ssh/id_rsa` must be rejected, not served.

### Diff viewer

New `DiffController` + `DiffService` over a `GitAdapter`:

- `GET /api/repos/:slug/diff?base=&head=` → `git diff`, parsed into hunks server-side so the
  frontend receives structured data, not raw text.
- PR-level diffs via `gh pr diff`, reusing the active account from `AccountsService`.
- **The high-value tie-in:** agent file edits already stream as `{t: 'tool', body: 'edit <path>'}`
  (`lib/engine.js:111`). Extend that event to carry the path and the transcript can render an
  inline diff of what the agent just changed — the thing that makes the drawer better than a
  terminal rather than merely equal to one.

Render with **Shiki** for syntax highlighting over custom hunk components. This nested, stateful UI
is what justifies Svelte over the current imperative DOM.

The API roughly doubles with these (files, diff, git metadata) — the strongest practical argument
for adopting Nest's module structure now rather than retrofitting later.

## TypeScript 7 + NestJS — spiked and confirmed working

The risk was that TS 7 is the Go-port compiler while `@nestjs/core@11.2.1` still depends on
`reflect-metadata` — Nest DI needs `experimentalDecorators` + `emitDecoratorMetadata`.

**Result: it works.** Verified against `typescript@7.0.2` + `@nestjs/core@11.2.1` with a provider
injected by constructor and **no `@Inject()` token** — the case that fails if `design:paramtypes`
is not emitted:

```
design:paramtypes emitted = [ 'ClaudeDriver' ]
DI resolved  = claude ran: spike
```

TS 7 emits decorator metadata correctly and Nest resolves the graph at runtime. **No TS 6.x
fallback is needed.**

Two TS 7 migration details found while spiking, both affecting `tsconfig.json`:

- **`rootDir` must be explicit** when `outDir` is set, or compilation fails with `TS5011`. TS 6
  inferred it.
- **`types: ["node"]` must be listed explicitly**; installing `@types/node` alone is no longer
  enough to get ambient `process`.

Working baseline `tsconfig.json` for the backend:

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2023",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "esModuleInterop": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src/**/*"]
}
```

## De-personalisation required before publishing

The current code assumes one specific machine. Most of it already uses `homedir()` correctly, so
the surface is small:

| Location | Issue |
|---|---|
| `lib/repos.js:9` | `ROOTS = [~/glair, ~/personal]` — hardcoded personal scan roots. **The blocker.** |
| `public/index.html:95`, `README.md:22` | `GDP-ADMIN` org name in user-facing copy |
| `lib/accounts.js:8`, `lib/seen.js:5` | `~/.ai-dashboard` — rename to `~/.flightdeck` |
| `README.md` "Known environment issue" | machine-specific apparmor section; reframe as general troubleshooting |

Scan roots move to `~/.flightdeck/config.json` via `@nestjs/config`, with a first-run UI prompt.

## Rejected alternatives

- **Next.js** — request-scoped route handlers, and dev HMR reloads modules, wiping the thread
  registry mid-run and orphaning spawned children. Parked approval resolvers cannot survive at all.
- **Python / Go / Rust** — full rewrites landing on the same architecture. Codex remains a
  subprocess regardless; Go and Rust additionally have no first-party agent SDK, so the stream-json
  protocol would be hand-maintained.
- **MVC** — there is no View layer (the frontend is a separate SPA), and the "model" is live
  sessions holding child-process handles and parked promises, not data. MSC is the right shape.
- **`worker_threads`** — the app is entirely I/O-bound with no CPU work to offload, and parallelism
  already exists (each Codex run is its own OS process, as is the Claude SDK's subprocess). Workers
  cannot hold promise resolvers or response-writing closures, since functions are not
  structured-cloneable, so crossing a worker boundary would mean hand-building a message bus to
  recreate what a shared `Map` provides for free. The real gap is durability, not throughput.
- **Redis** — cannot persist what actually breaks on restart: process-bound child handles and
  promise resolvers. It would persist the event buffer and thread metadata (useful history, not
  liveness), while burdening an npm-distributed local tool with an external binary. `better-sqlite3`
  is embedded, needs no external process, and gives the same durability. Redis only becomes correct
  if Flight Deck ever goes multi-process or hosted.

## Roadmap

1. ~~Spike TS 7 + Nest decorator metadata~~ — **done, passed.** TS 7.0.2 + Nest 11 confirmed
   working; see the TypeScript section above for the verified `tsconfig.json`.
2. npm workspaces: `server/`, `web/`, `shared/`. Type the event union in `shared/` first.
3. Scaffold Nest; port `lib/` to services. `DeriveService` first (pure, easily tested).
4. Define `EngineDriver`; `ClaudeDriver` real, `CodexDriver` stubbed.
5. `@Sse()` gateway; `OnApplicationShutdown` to reap children.
6. Rebuild `web/` in Svelte 5 runes; serve via `@nestjs/serve-static`.
7. De-personalise; `~/.flightdeck/config.json` + first-run prompt.
8. `bin` entry, `npx flightdeck`, publish.
9. Feature work: `Autocomplete` + `/` skill provider, then `@` file provider with `FilesController`
   (git ls-files + traversal guard), then the diff viewer.
10. SQLite persistence + restart rehydration.
