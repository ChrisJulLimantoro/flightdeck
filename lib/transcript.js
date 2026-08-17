import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const CLAUDE_PROJECTS = join(homedir(), ".claude", "projects");
const CODEX_SESSIONS = join(homedir(), ".codex", "sessions");

const parseLines = (source) =>
  source.split("\n").filter(Boolean).flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });

const stamp = (value) => (value ? Date.parse(value) : Date.now());

/* ---------- Claude: ~/.claude/projects/<slug>/<sessionId>.jsonl ---------- */

async function findClaudeFile(sessionId) {
  const projects = await readdir(CLAUDE_PROJECTS, { withFileTypes: true });
  for (const project of projects.filter((entry) => entry.isDirectory())) {
    const path = join(CLAUDE_PROJECTS, project.name, `${sessionId}.jsonl`);
    const source = await readFile(path, "utf8").catch(() => null);
    if (source) return source;
  }
  return null;
}

// The on-disk `message` object is the same shape the SDK yields, so text and
// tool_use blocks map exactly as they do for a live run.
function claudeEntry(entry) {
  const ts = stamp(entry.timestamp);
  if (entry.type === "user" && typeof entry.message?.content === "string") {
    return { t: "user", body: entry.message.content, ts };
  }
  if (entry.type !== "assistant") return undefined;
  const content = entry.message?.content ?? [];
  const text = content.filter((block) => block.type === "text").map((block) => block.text).join("");
  if (text.trim()) return { t: "text", body: text, ts };
  const tool = content.find((block) => block.type === "tool_use");
  return tool ? { t: "tool", body: tool.name, ts } : undefined;
}

async function readClaude(sessionId) {
  const source = await findClaudeFile(sessionId);
  if (!source) throw new Error(`no Claude transcript for ${sessionId}`);
  const entries = parseLines(source);
  return {
    cwd: entries.find((entry) => entry.cwd)?.cwd,
    events: entries.map(claudeEntry).filter(Boolean),
  };
}

/* ---------- Codex: dated rollout files under ~/.codex/sessions ---------- */

async function findCodexFile(sessionId) {
  const entries = await readdir(CODEX_SESSIONS, { recursive: true });
  const match = entries.find((entry) => entry.endsWith(`${sessionId}.jsonl`));
  if (!match) return null;
  return readFile(join(CODEX_SESSIONS, match), "utf8");
}

const CODEX_EVENTS = {
  user_message: (payload) => ({ t: "user", body: payload.message }),
  agent_message: (payload) => (payload.message ? { t: "text", body: payload.message } : undefined),
};

function codexEntry(entry) {
  const ts = stamp(entry.timestamp);
  if (entry.type === "event_msg") {
    const event = CODEX_EVENTS[entry.payload.type]?.(entry.payload);
    return event && { ...event, ts };
  }
  if (entry.type === "response_item" && entry.payload.type === "custom_tool_call") {
    return { t: "tool", body: entry.payload.name ?? "tool", ts };
  }
  return undefined;
}

async function readCodex(sessionId) {
  const source = await findCodexFile(sessionId);
  if (!source) throw new Error(`no Codex rollout for ${sessionId}`);
  const entries = parseLines(source);
  return {
    cwd: entries.find((entry) => entry.type === "session_meta")?.payload.cwd,
    events: entries.map(codexEntry).filter(Boolean),
  };
}

const READERS = { claude: readClaude, codex: readCodex };

export function readTranscript(engine, sessionId) {
  const reader = READERS[engine];
  if (!reader) throw new Error(`unknown engine ${engine}`);
  return reader(sessionId);
}
