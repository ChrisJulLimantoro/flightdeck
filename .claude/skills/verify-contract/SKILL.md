---
name: verify-contract
description: Verify a Flight Deck backend change did not break the HTTP contract the web client depends on. Use after editing anything under server/src, before committing a backend change, or when the board or drawer stops working after a server edit. Checks route shapes, error bodies, status codes, SSE framing and the SPA fallback against a running server.
---

# Verify the HTTP contract

`web/` is built against a fixed contract and there is no test suite. NestJS changes several parts of
that contract by default, so a backend edit can compile, start, and still break the UI. This checks
the parts that actually break.

## 1. Build and start

```bash
pnpm build && pnpm start
```

Wait for `flight deck → http://127.0.0.1:4321`.

## 2. Route shapes

Every route must answer with the keys the client reads.

```bash
for r in accounts prs agents skills health threads; do
  echo "--- /api/$r"; curl -s --max-time 60 "http://127.0.0.1:4321/api/$r" | head -c 200; echo
done
```

`/api/prs` rows must carry `cloned` and `codexTrusted`, and must **not** carry `path` — the local
checkout path is server-side knowledge and leaking it is a regression that was deliberately fixed.

## 3. Error bodies — the part Nest silently changes

The client reads `body.error` (`web/src/lib/api/client.ts`). Nest's default failure body is
`{statusCode, message, error: "Bad Request"}`, which would show the user "Bad Request" instead of the
real message. `server/src/common/error.filter.ts` prevents that. Confirm it still works:

```bash
probe() { echo "$1 $2 -> $(curl -s -o /tmp/c.out -w '%{http_code}' -X "$1" \
  "http://127.0.0.1:4321$2" -H 'Content-Type: application/json' -d "$3") $(cat /tmp/c.out)"; }

probe POST /api/threads '{"engine":"nope","repo":"x"}'                    # 400 {"error":"unknown engine"}
probe POST /api/threads '{"engine":"claude","repo":"no/such","prompt":"hi"}'  # 400 ... is not cloned locally
probe POST /api/threads/nope/turn '{"prompt":"hi"}'                       # 404 {"error":"unknown thread"}
probe POST /api/threads/nope/stop '{}'                                    # 200 {"stopped":false}  <- NOT 404
probe POST /api/accounts '{"token":""}'                                   # 400 {"error":"token is empty"}
probe POST /api/sessions/bogus/x/open '{}'                                # 400 {"error":"unknown engine bogus"}
```

Every body must be exactly `{"error": "<the real message>"}`. Every POST must answer **200**, not
201 — that is what `@HttpCode(200)` is for, and a new route without it is a silent break.

## 4. Static serving

```bash
curl -s -o /dev/null -w 'shell   %{http_code}\n' http://127.0.0.1:4321/
curl -s -o /dev/null -w 'spa     %{http_code}\n' http://127.0.0.1:4321/anything   # 200, the shell
curl -s -o /dev/null -w 'api404  %{http_code}\n' http://127.0.0.1:4321/api/nope   # 404, NOT the shell
```

An unknown `/api/*` path answering 200 means the `ServeStaticModule` exclude is broken.

## 5. The stream, if threads were touched

Pick a repo the board says is cloned, then run a real turn and watch the sequence:

```bash
ID=$(curl -s -X POST http://127.0.0.1:4321/api/threads -H 'Content-Type: application/json' \
  -d '{"engine":"claude","prompt":"Reply with exactly: ok","repo":"OWNER/REPO","mode":"read"}' \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).id))')
curl -sN "http://127.0.0.1:4321/api/stream/$ID"
```

Expect `user → tool(context: …) → status → session → text → result → turn(idle)`, each frame a
`data:` line of JSON. The client does `JSON.parse(message.data)`, so anything else breaks the drawer.

For approvals, launch with `"approvals":true` and a prompt forcing a `Write`, then resolve the ask:

```bash
curl -s -X POST "http://127.0.0.1:4321/api/threads/$ID/permission" \
  -H 'Content-Type: application/json' -d '{"askId":"<from the ask event>","decision":"allow"}'
```

Expect `{"resolved":true}` and a `verdict` event in the stream.

## 6. Shutdown reaping, if the registry was touched

Start a long turn, note the server's children, SIGTERM it, and confirm none survive:

```bash
PID=$(ss -ltnp | grep 4321 | grep -o 'pid=[0-9]*' | cut -d= -f2)
DESC=$(pgrep -P $PID | tr '\n' ' ')   # expect at least one agent CLI here
kill -TERM $PID; sleep 6
for c in $DESC; do kill -0 $c 2>/dev/null && echo "ORPHAN $c"; done
```

Nothing printed is a pass. An orphan means `onApplicationShutdown` returned before the child died —
it must stay `async` and drain.

## 7. Architecture

```bash
pnpm graph:check && pnpm check
```

## Report honestly

State which steps ran and what they returned. If a step was skipped, say so — do not infer a passing
contract from a clean compile.
