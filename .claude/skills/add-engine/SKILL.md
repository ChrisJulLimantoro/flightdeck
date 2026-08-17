---
name: add-engine
description: Add a new agent engine (alongside Claude and Codex) to Flight Deck via the EngineDriver port. Use when asked to support another CLI or agent SDK, wire a new backend engine, or when tempted to add an `engine === "..."` branch anywhere. Covers the driver, its registration, the shared type, and the UI toggle.
---

# Add an engine

Engines live behind one port. Done properly, a new engine touches four files and nothing in the
thread, approval or SSE logic. If you find yourself adding an `engine === "x"` check outside a
driver, stop — that branching is exactly what this port removed.

## 1. The type

`shared/src/events.ts`:

```ts
export type EngineName = "claude" | "codex" | "yourengine";
```

Adding it here is deliberate: the frontend engine toggle and every DTO narrow off this union, so the
compiler will now point at each place that must handle it.

## 2. The driver

`server/src/threads/drivers/yourengine.driver.ts`, implementing `EngineDriver`:

```ts
@Injectable()
export class YourDriver implements EngineDriver {
  readonly engine: EngineName = "yourengine";
  readonly supportsApprovals = false;   // true only if the engine can park a tool call

  async run(ctx: TurnContext, prompt: string): Promise<void> {
    ctx.emit(await contextFileEvent(ctx.cwd, "AGENTS.md"));  // say which context file applies
    // ... start the work, then:
    ctx.onStop(() => /* interrupt it */);
    // ... for each piece of output:
    ctx.emit({ t: "text", body: "..." });
    // ... when the engine reports its resumable id:
    ctx.adoptSession(id);
  }
}
```

Rules the driver must respect:

- **Only touch `ctx`.** No registry, no other service. That is what makes a driver testable without
  the whole app, and it is the reason the port exists.
- **Every emitted event must be a `ThreadEvent` variant** from `shared/`. Do not invent an ad-hoc
  shape — the client's transcript switch is exhaustive and a new variant belongs in `shared` first.
- **`run` resolves when the turn is done and rejects on failure.** `TurnService` turns that into
  `turn(idle)` or an `error` event plus `turn(failed)`; do not emit those yourself.
- **`ctx.onStop` must actually interrupt**, and quickly. Shutdown reaping depends on it: the registry
  aborts, then drains for 5s. A child process that ignores it becomes an orphan.
- **A missing binary is a message, not a crash** — catch `ENOENT` and throw a sentence telling the
  user what to install, as `CodexDriver` does.

## 3. Registration

`server/src/threads/threads.module.ts` — add the provider and the factory entry:

```ts
providers: [
  /* ... */ YourDriver,
  { provide: ENGINE_DRIVERS,
    useFactory: (c: ClaudeDriver, x: CodexDriver, y: YourDriver) => [c, x, y],
    inject: [ClaudeDriver, CodexDriver, YourDriver] },
]
```

That is the whole backend wiring. `TurnService.driverFor` picks by `engine`, and approvals follow
`supportsApprovals`.

## 4. The UI toggle

`web/src/components/Masthead.svelte` holds the engine list. The board's block reasons
(`prs.blockReason`) and the run dialog's approvals note read the engine too — check both, since the
Codex-specific copy there should not apply to a new engine by accident.

## 5. Sessions strip, if the engine can list sessions

`AgentsService` reports live sessions per engine. Claude shells out to `claude agents --json`; Codex
has no such API, so `TurnService` records what it started via `agents.own()`. Follow whichever
applies. If neither, return an empty list — the strip is decoration and must never break the board.

## 6. Verify

```bash
pnpm check && pnpm graph:check
```

Then run a real turn on the new engine and confirm the stream sequence, per `/verify-contract`. Also
confirm the *other* engines still work: a change to the driver list is easy to get subtly wrong.
