# Flight Deck — working notes for agents

Read this before changing anything. It records the constraints that are not visible from a single
file, and the mistakes that are easy to make here.

## Shape

Three pnpm workspaces. `server/` is the published npm package; `shared/` and `web/` are private.

```
shared/   types only — the ThreadEvent union and API DTOs. Imported by BOTH sides, type-only.
web/      Svelte 5 runes SPA (Vite) → web/dist → copied into server/public at build time.
server/   NestJS, Model-Service-Controller. Serves the API and the built SPA.
```

`pnpm graph` regenerates `docs/dependency-graph.md`; `pnpm graph:check` fails the build if the
layering breaks. Run it after moving code between packages.

## Commands

```bash
corepack enable pnpm && pnpm install
pnpm check          # tsc over shared + server, svelte-check over web
pnpm build          # web → web/dist → server/public, server → server/dist
pnpm start          # → http://127.0.0.1:4321
pnpm graph:check    # architecture rules
```

There is **no test suite yet**. "It compiles" is not "it works" — verify against a running server.

## The rules that matter

**1. `shared/src/events.ts` is a contract, not a convenience.**
The server emits `ThreadEvent`s and the web client consumes them. Adding a variant there without
handling it in `web/src/lib/transcript.ts` is a compile error, by design — the exhaustive switch and
its `unhandled(event: never)` are load-bearing. Do not silence it with a `default` case.

**2. Never break the HTTP contract without changing both sides in the same commit.**
The web client reads `body.error` on failure. Nest's default error body is
`{statusCode, message, error: "Bad Request"}`, which would surface "Bad Request" to the user instead
of the real message — `server/src/common/error.filter.ts` exists solely to prevent that. Likewise
every POST carries `@HttpCode(200)`: Nest defaults to 201 and the old server answered 200.

**3. `shared/` must stay type-only.**
It is a `devDependency` of `server/`, so a *runtime* import of it would resolve on your machine and
fail for anyone who installs the package from npm. `pnpm graph:check` enforces this. The same rule
covers every devDependency in `server/src`.

**4. Engines go behind the driver port.**
`server/src/threads/drivers/engine-driver.port.ts`. Adding an engine means writing one driver and
listing it in `threads.module.ts`. Do not add `engine === "claude"` branches anywhere else — read
`supportsApprovals` instead. That branching is what the port was built to remove.

**5. Assume nothing about the machine.**
This ships as `npx flightdeck`. No hardcoded paths, no assumption that `gh`, `claude` or `codex`
exists. Missing tools degrade to a clear message; see `SkillsService.list` and `GithubAdapter.gh`
for the pattern. Repo discovery walks `$HOME` — never a personal directory list.

**6. Shutdown must reap children.**
`ThreadRegistry.onApplicationShutdown` is `async` on purpose. Aborting only *asks* the SDK to stop;
returning immediately lets the process exit before the agent CLI dies, and it is reparented to init.
If you touch it, re-test by SIGTERMing the server mid-turn and checking for orphans.

## Verifying a backend change

The API surface is small and there is no test suite, so diff it against a running server:

```bash
pnpm build && pnpm start
curl -s localhost:4321/api/prs | head -c 300
# error contract — the thing Nest silently changes
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:4321/api/threads \
  -H 'Content-Type: application/json' -d '{"engine":"nope","repo":"x"}'   # expect 400
curl -s localhost:4321/api/nope -o /dev/null -w '%{http_code}\n'          # expect 404, not the SPA shell
```

For anything touching threads, run a real turn and watch the stream — the full expected sequence is
`user → tool(context) → status → session → text → result → turn(idle)`:

```bash
ID=$(curl -s -X POST localhost:4321/api/threads -H 'Content-Type: application/json' \
  -d '{"engine":"claude","prompt":"reply with ok","repo":"OWNER/REPO","mode":"read"}' | jq -r .id)
curl -sN localhost:4321/api/stream/$ID
```

## Conventions

- Commit messages: `type(scope): title`, then bullets, each ≤25 words. **No AI attribution of any
  kind** — no `Co-Authored-By`, no generated-with footer.
- Code style is Five Lines of Code: small functions, guard clauses first, one level of abstraction
  each, descriptive names. Minimal never means cryptic.
- Comments explain *why*, especially where the code looks odd — most odd-looking code here is odd
  because of a constraint recorded above.
- Never read or commit `.env` files, or `~/.flightdeck/auth.json`, which holds real tokens.
