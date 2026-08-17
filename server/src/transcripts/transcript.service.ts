import { BadRequestException, Injectable } from "@nestjs/common";
import type { ThreadEvent } from "@flightdeck/shared";
import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const CLAUDE_PROJECTS = join(homedir(), ".claude", "projects");
const CODEX_SESSIONS = join(homedir(), ".codex", "sessions");

export interface Transcript {
  cwd?: string;
  events: ThreadEvent[];
}

/** Sessions started outside Flight Deck, replayed from disk into our event shape. */
@Injectable()
export class TranscriptService {
  read(engine: string, sessionId: string): Promise<Transcript> {
    if (engine === "claude") return readClaude(sessionId);
    if (engine === "codex") return readCodex(sessionId);
    throw new BadRequestException(`unknown engine ${engine}`);
  }
}

const parseLines = (source: string): Record<string, any>[] =>
  source
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as Record<string, any>];
      } catch {
        return [];
      }
    });

const stamp = (value?: string) => (value ? Date.parse(value) : Date.now());

/* ---------- Claude: ~/.claude/projects/<slug>/<sessionId>.jsonl ---------- */

async function findClaudeFile(sessionId: string): Promise<string | null> {
  const projects = await readdir(CLAUDE_PROJECTS, { withFileTypes: true }).catch(() => []);
  for (const project of projects.filter((entry) => entry.isDirectory())) {
    const path = join(CLAUDE_PROJECTS, project.name, `${sessionId}.jsonl`);
    const source = await readFile(path, "utf8").catch(() => null);
    if (source) return source;
  }
  return null;
}

/**
 * The on-disk `message` object is the same shape the SDK yields, so text and
 * tool_use blocks map exactly as they do for a live run.
 */
function claudeEntry(entry: Record<string, any>): ThreadEvent | undefined {
  const ts = stamp(entry.timestamp);
  if (entry.type === "user" && typeof entry.message?.content === "string") {
    return { t: "user", body: entry.message.content, ts };
  }
  if (entry.type !== "assistant") return undefined;
  const content: any[] = entry.message?.content ?? [];
  const text = content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
  if (text.trim()) return { t: "text", body: text, ts };
  const tool = content.find((block) => block.type === "tool_use");
  return tool ? { t: "tool", body: tool.name, ts } : undefined;
}

async function readClaude(sessionId: string): Promise<Transcript> {
  const source = await findClaudeFile(sessionId);
  // 400, not 404: the old server surfaced every adopt failure as a bad request
  // and the client shows the message verbatim.
  if (!source) throw new BadRequestException(`no Claude transcript for ${sessionId}`);
  const entries = parseLines(source);
  return {
    cwd: entries.find((entry) => entry.cwd)?.cwd,
    events: entries.map(claudeEntry).filter((event): event is ThreadEvent => Boolean(event)),
  };
}

/* ---------- Codex: dated rollout files under ~/.codex/sessions ---------- */

async function findCodexFile(sessionId: string): Promise<string | null> {
  const entries = await readdir(CODEX_SESSIONS, { recursive: true }).catch(() => [] as string[]);
  const match = entries.find((entry) => entry.endsWith(`${sessionId}.jsonl`));
  if (!match) return null;
  return readFile(join(CODEX_SESSIONS, match), "utf8").catch(() => null);
}

function codexEntry(entry: Record<string, any>): ThreadEvent | undefined {
  const ts = stamp(entry.timestamp);
  if (entry.type === "event_msg") {
    if (entry.payload.type === "user_message") return { t: "user", body: entry.payload.message, ts };
    if (entry.payload.type === "agent_message" && entry.payload.message) {
      return { t: "text", body: entry.payload.message, ts };
    }
    return undefined;
  }
  if (entry.type === "response_item" && entry.payload.type === "custom_tool_call") {
    return { t: "tool", body: entry.payload.name ?? "tool", ts };
  }
  return undefined;
}

async function readCodex(sessionId: string): Promise<Transcript> {
  const source = await findCodexFile(sessionId);
  if (!source) throw new BadRequestException(`no Codex rollout for ${sessionId}`);
  const entries = parseLines(source);
  return {
    cwd: entries.find((entry) => entry.type === "session_meta")?.payload.cwd,
    events: entries.map(codexEntry).filter((event): event is ThreadEvent => Boolean(event)),
  };
}
