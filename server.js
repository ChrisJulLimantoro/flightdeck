import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { accounts, activeAccount, addAccount, publicView, removeAccount, setActive } from "./lib/accounts.js";
import { listAgents } from "./lib/agents.js";
import { deriveMine, deriveReviewed } from "./lib/derive.js";
import {
  adoptThread,
  getThread,
  listThreads,
  resolvePermission,
  startTurn,
  stopThread,
  subscribe,
  summarise,
} from "./lib/engine.js";
import { fetchPullRequests, viewer } from "./lib/github.js";
import { resolveRepo } from "./lib/repos.js";
import { codexSandbox } from "./lib/sandbox.js";
import { markSeen, seen } from "./lib/seen.js";
import { listSkills } from "./lib/skills.js";
import { readTranscript } from "./lib/transcript.js";

const PORT = Number(process.env.PORT ?? 4321);
const HERE = dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json());
app.use(express.static(join(HERE, "public")));

// Keyed so switching account can never serve the previous account's rows.
function keyedCache(ttl, load) {
  const entries = new Map();
  return (key, force = false) => {
    const hit = entries.get(key);
    if (!force && hit && Date.now() - hit.at < ttl) return hit.value;
    const value = load(key).catch((error) => {
      entries.delete(key);
      throw error;
    });
    entries.set(key, { at: Date.now(), value });
    return value;
  };
}

const withRepo = async (pr) => ({ ...pr, ...(await resolveRepo(pr.repo)) });

const loadPrs = keyedCache(60_000, async () => {
  const [me, { mine, reviewed }, marks] = await Promise.all([viewer(), fetchPullRequests(), seen()]);
  return {
    viewer: me,
    fetchedAt: Date.now(),
    mine: await Promise.all(deriveMine(mine, me, marks).map(withRepo)),
    reviewed: await Promise.all(deriveReviewed(reviewed, me, marks).map(withRepo)),
  };
});

const loadAgents = keyedCache(2_000, listAgents);

const fail = (res) => (error) => res.status(400).json({ error: error.message });

/* ---------- accounts ---------- */

const accountsView = async () => ({
  active: (await activeAccount()).login,
  accounts: (await accounts()).map(publicView),
});

app.get("/api/accounts", (req, res) => accountsView().then((data) => res.json(data), fail(res)));

app.post("/api/accounts", (req, res) =>
  addAccount(req.body.token).then(() => accountsView()).then((data) => res.json(data), fail(res)));

app.post("/api/accounts/active", (req, res) =>
  setActive(req.body.login).then(() => accountsView()).then((data) => res.json(data), fail(res)));

app.delete("/api/accounts/:login", (req, res) =>
  removeAccount(req.params.login).then(() => accountsView()).then((data) => res.json(data), fail(res)));

/* ---------- read-only data ---------- */

app.get("/api/prs", async (req, res) => {
  const account = await activeAccount();
  loadPrs(account.login ?? "gh", "fresh" in req.query).then((data) => res.json(data), fail(res));
});

app.get("/api/agents", (req, res) => loadAgents("all").then((data) => res.json(data), fail(res)));
app.get("/api/skills", (req, res) => listSkills().then((data) => res.json(data), fail(res)));
app.get("/api/health", (req, res) =>
  codexSandbox().then((codex) => res.json({ codexSandbox: codex }), fail(res)));

app.post("/api/seen", (req, res) =>
  markSeen(req.body.id).then((at) => res.json({ id: req.body.id, at }), fail(res)));

/* ---------- threads ---------- */

// Both CLIs resolve skills from the same skills directory, so the prompt is
// identical for either engine.
const buildPrompt = ({ skill, target, prompt }) =>
  skill ? `/${skill}${target ? ` ${target}` : ""}` : prompt;

app.get("/api/threads", (req, res) => res.json(listThreads()));

app.post("/api/threads", async (req, res) => {
  const { engine, skill, target, prompt, repo, mode, approvals } = req.body;
  if (!["claude", "codex"].includes(engine)) return res.status(400).json({ error: "unknown engine" });
  const text = buildPrompt({ skill, target, prompt });
  if (!text?.trim()) return res.status(400).json({ error: "nothing to send" });
  const { path, cloned, codexTrusted } = await resolveRepo(repo ?? "");
  if (!cloned) return res.status(400).json({ error: `${repo} is not cloned locally` });
  if (engine === "codex" && !codexTrusted) {
    return res.status(400).json({ error: `${repo} is not a trusted Codex project` });
  }
  try {
    const thread = startTurn({
      engine,
      skill: skill ?? "prompt",
      label: target ?? repo,
      prompt: text,
      cwd: path,
      mode: ["write", "unsandboxed"].includes(mode) ? mode : "read",
      approvals,
    });
    res.json(summarise(thread));
  } catch (error) {
    fail(res)(error);
  }
});

app.post("/api/threads/:id/turn", (req, res) => {
  const thread = getThread(req.params.id);
  if (!thread) return res.status(404).json({ error: "unknown thread" });
  if (!req.body.prompt?.trim()) return res.status(400).json({ error: "nothing to send" });
  try {
    res.json(summarise(startTurn({ threadId: thread.id, prompt: req.body.prompt })));
  } catch (error) {
    fail(res)(error);
  }
});

app.post("/api/threads/:id/permission", (req, res) => {
  const thread = getThread(req.params.id);
  if (!thread) return res.status(404).json({ error: "unknown thread" });
  const { askId, decision } = req.body;
  if (!["allow", "deny"].includes(decision)) return res.status(400).json({ error: "bad decision" });
  res.json({ resolved: resolvePermission(thread, askId, decision) });
});

app.post("/api/threads/:id/stop", (req, res) => res.json({ stopped: stopThread(req.params.id) }));

/* ---------- adopting sessions started elsewhere ---------- */

app.post("/api/sessions/:engine/:sessionId/open", async (req, res) => {
  const { engine, sessionId } = req.params;
  try {
    const { cwd, events } = await readTranscript(engine, sessionId);
    const thread = adoptThread({ engine, sessionId, cwd, events, fork: Boolean(req.body?.fork) });
    res.json(summarise(thread));
  } catch (error) {
    fail(res)(error);
  }
});

/* ---------- stream ---------- */

app.get("/api/stream/:id", (req, res) => {
  const thread = getThread(req.params.id);
  if (!thread) return res.status(404).end();
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  const unsubscribe = subscribe(thread, send);
  req.on("close", unsubscribe);
});

app.listen(PORT, "127.0.0.1", () => console.log(`flight deck → http://127.0.0.1:${PORT}`));
