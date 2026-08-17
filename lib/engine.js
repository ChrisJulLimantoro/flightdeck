import { query } from "@anthropic-ai/claude-agent-sdk";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { ownedCodex } from "./agents.js";

// threadId -> thread. A thread is one engine session across many turns; the
// event buffer spans all of them, so SSE replay returns the whole conversation.
const threads = new Map();

const ASK_TIMEOUT_MS = 120_000;

const MODES = {
  claude: { read: "plan", write: "acceptEdits", unsandboxed: "acceptEdits" },
  codex: { read: "read-only", write: "workspace-write", unsandboxed: "danger-full-access" },
};

function emit(thread, event) {
  const stamped = { ...event, ts: Date.now() };
  thread.events.push(stamped);
  for (const send of thread.subscribers) send(stamped);
}

function settle(thread, status) {
  thread.status = status;
  thread.stop = undefined;
  emit(thread, { t: "turn", body: status });
  if (thread.engine === "codex" && thread.sessionId) {
    ownedCodex.set(thread.sessionId, { cwd: thread.cwd, name: thread.skill, status, startedAt: thread.startedAt });
  }
}

function adoptSession(thread, sessionId) {
  if (thread.sessionId === sessionId) return;
  thread.sessionId = sessionId;
  emit(thread, { t: "session", body: sessionId });
  if (thread.engine !== "codex") return;
  ownedCodex.delete(thread.id);
  ownedCodex.set(sessionId, { cwd: thread.cwd, name: thread.skill, status: "running", startedAt: thread.startedAt });
}

/* ---------- live tool approval (Claude only) ---------- */

function askPermission(thread, toolName, input) {
  const askId = randomUUID();
  emit(thread, { t: "ask", askId, tool: toolName, body: JSON.stringify(input).slice(0, 400) });
  return new Promise((resolve) => {
    // A closed tab must never wedge a session: unanswered asks auto-deny.
    const timer = setTimeout(() => resolvePermission(thread, askId, "timeout"), ASK_TIMEOUT_MS);
    thread.pending.set(askId, { resolve, timer, input });
  });
}

const VERDICTS = {
  allow: (input) => ({ behavior: "allow", updatedInput: input }),
  deny: () => ({ behavior: "deny", message: "denied by the operator in Flight Deck" }),
  timeout: () => ({ behavior: "deny", message: "no answer within 120s — auto-denied" }),
};

export function resolvePermission(thread, askId, decision) {
  const ask = thread.pending.get(askId);
  if (!ask) return false;
  clearTimeout(ask.timer);
  thread.pending.delete(askId);
  emit(thread, { t: "verdict", askId, body: decision });
  ask.resolve(VERDICTS[decision](ask.input));
  return true;
}

/* ---------- Claude ---------- */

function assistantEvent(content) {
  const text = content.filter((block) => block.type === "text").map((block) => block.text).join("");
  if (text.trim()) return { t: "text", body: text };
  const tool = content.find((block) => block.type === "tool_use");
  return tool ? { t: "tool", body: tool.name } : undefined;
}

function claudeEvent(message) {
  if (message.type === "system" && message.subtype === "init") return { t: "session", body: message.session_id };
  if (message.type === "assistant") return assistantEvent(message.message.content);
  if (message.type === "result") return { t: "result", body: message.result ?? message.subtype };
  return undefined;
}

async function pumpClaude(thread, prompt) {
  const session = query({
    prompt,
    options: {
      cwd: thread.cwd,
      permissionMode: thread.approvals ? "default" : MODES.claude[thread.mode],
      canUseTool: thread.approvals ? (tool, input) => askPermission(thread, tool, input) : undefined,
      resume: thread.sessionId,
      forkSession: thread.fork,
      abortController: thread.abort,
    },
  });
  thread.stop = () => session.interrupt?.();
  for await (const message of session) {
    const event = claudeEvent(message);
    if (event?.t === "session") adoptSession(thread, event.body);
    else if (event) emit(thread, event);
  }
}

/* ---------- Codex ---------- */

const CODEX_ITEMS = {
  agent_message: (item) => ({ t: "text", body: item.text }),
  reasoning: (item) => ({ t: "think", body: item.text }),
  command_execution: (item) => ({ t: "tool", body: item.command }),
  file_change: (item) => ({ t: "tool", body: `edit ${item.path ?? ""}` }),
};

const BWRAP = /bwrap:|Failed RTM_NEWADDR|setting up uid map/;

function codexEvent(line) {
  const event = JSON.parse(line);
  if (BWRAP.test(line)) {
    return { t: "error", body: "codex sandbox failed to start (bwrap/user namespaces blocked) — see the health banner" };
  }
  if (event.type === "thread.started") return { t: "session", body: event.thread_id };
  if (event.type === "item.completed") return CODEX_ITEMS[event.item.type]?.(event.item);
  if (event.type === "turn.failed") return { t: "error", body: event.error?.message ?? "turn failed" };
  if (event.type === "turn.completed") return { t: "result", body: `${event.usage.output_tokens} output tokens` };
  return undefined;
}

function readLines(stream, onLine) {
  let buffer = "";
  stream.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) onLine(line);
  });
}

// `codex exec resume` accepts neither -C nor -s, so cwd comes from the child
// process and the sandbox from a config override — one arg shape for both paths.
function codexArgs(thread, prompt) {
  const common = ["--json", "--skip-git-repo-check", "-c", `sandbox_mode="${MODES.codex[thread.mode]}"`];
  if (!thread.sessionId) return ["exec", ...common, prompt];
  return ["exec", "resume", ...common, thread.sessionId, prompt];
}

function pumpCodex(thread, prompt) {
  const child = spawn("codex", codexArgs(thread, prompt), { cwd: thread.cwd, stdio: ["ignore", "pipe", "pipe"] });
  thread.stop = () => child.kill("SIGTERM");
  readLines(child.stdout, (line) => {
    let event;
    try {
      event = codexEvent(line);
    } catch {
      return;
    }
    if (event?.t === "session") adoptSession(thread, event.body);
    else if (event) emit(thread, event);
  });
  // codex announces the stdin it will never read; not worth showing.
  const NOISE = /Reading additional input from stdin/;
  readLines(child.stderr, (line) => NOISE.test(line) || emit(thread, { t: "stderr", body: line }));
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`codex exited ${code}`))));
  });
}

/* ---------- public ---------- */

const PUMPS = { claude: pumpClaude, codex: pumpCodex };

function createThread({ engine, skill, label, cwd, mode, approvals, sessionId, fork }) {
  const thread = {
    id: randomUUID(),
    engine,
    skill: skill ?? "prompt",
    label,
    cwd,
    mode: mode ?? "read",
    approvals: Boolean(approvals) && engine === "claude",
    sessionId,
    fork: Boolean(fork),
    status: "idle",
    startedAt: Date.now(),
    events: [],
    subscribers: new Set(),
    pending: new Map(),
    abort: new AbortController(),
  };
  threads.set(thread.id, thread);
  return thread;
}

export function startTurn({ threadId, prompt, ...spec }) {
  const thread = threadId ? threads.get(threadId) : createThread(spec);
  if (!thread) throw new Error("unknown thread");
  if (thread.status === "running") throw new Error("that thread is still running");
  if (thread.engine === "codex" && !thread.sessionId) {
    ownedCodex.set(thread.id, { cwd: thread.cwd, name: thread.skill, status: "starting", startedAt: thread.startedAt });
  }
  thread.status = "running";
  emit(thread, { t: "user", body: prompt });
  PUMPS[thread.engine](thread, prompt)
    .then(() => settle(thread, "idle"))
    .catch((error) => {
      emit(thread, { t: "error", body: error.message });
      settle(thread, "failed");
    });
  return thread;
}

/** Bind a thread to a session this dashboard did not start, for replay + resume. */
export function adoptThread({ engine, sessionId, cwd, events, fork }) {
  const thread = createThread({ engine, skill: "adopted", label: sessionId, cwd, mode: "read", sessionId, fork });
  thread.events = events.map((event) => ({ ...event, replayed: true }));
  return thread;
}

export const getThread = (id) => threads.get(id);

export const summarise = (thread) => ({
  id: thread.id,
  engine: thread.engine,
  skill: thread.skill,
  label: thread.label,
  cwd: thread.cwd,
  status: thread.status,
  approvals: thread.approvals,
  sessionId: thread.sessionId,
  startedAt: thread.startedAt,
});

export const listThreads = () =>
  [...threads.values()].map(summarise).sort((a, b) => b.startedAt - a.startedAt);

export function stopThread(id) {
  const thread = threads.get(id);
  if (!thread || thread.status !== "running") return false;
  thread.abort.abort();
  thread.stop?.();
  settle(thread, "stopped");
  return true;
}

export function subscribe(thread, send) {
  for (const event of thread.events) send(event);
  send({ t: "status", body: thread.status, ts: Date.now() });
  thread.subscribers.add(send);
  return () => thread.subscribers.delete(send);
}
