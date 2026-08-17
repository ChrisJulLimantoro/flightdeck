import { Injectable } from "@nestjs/common";
import type { AgentSession, AgentStatus, AgentsResponse } from "@flightdeck/shared";
import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { keyedCache } from "../common/keyed-cache";

const run = promisify(execFile);
const SESSIONS = join(homedir(), ".codex", "sessions");
const RECENT_MS = 30 * 60 * 1000;
const TTL_MS = 2_000;

export interface OwnedSession {
  cwd: string;
  name: string;
  status: AgentStatus;
  startedAt: number;
}

@Injectable()
export class AgentsService {
  /**
   * Codex sessions this process started. Codex has no `agents --json`, so the
   * only way to report their real status is to remember what we launched;
   * `CodexDriver` keeps this current as turns start and settle.
   */
  private readonly ownedCodex = new Map<string, OwnedSession>();

  private readonly cache = keyedCache<AgentsResponse>(TTL_MS, () => this.load());

  list(): Promise<AgentsResponse> {
    return this.cache("all");
  }

  own(id: string, session: OwnedSession) {
    this.ownedCodex.set(id, session);
  }

  disown(id: string) {
    this.ownedCodex.delete(id);
  }

  private async load(): Promise<AgentsResponse> {
    return { claude: await claudeAgents(), codex: await this.codexAgents() };
  }

  /**
   * Reconstruct the Codex list: sessions we own, plus rollout files touched
   * recently — marked external, since their real status is unknowable.
   */
  private async codexAgents(): Promise<AgentSession[]> {
    const owned: AgentSession[] = [...this.ownedCodex.entries()].map(([id, session]) => ({
      engine: "codex",
      external: false,
      id,
      ...session,
    }));
    const ownedIds = new Set(this.ownedCodex.keys());
    const external = (await recentRollouts(Date.now() - RECENT_MS))
      .map((entry) => ({ id: idFromRollout(entry.file), mtime: entry.mtime }))
      .filter((entry) => !ownedIds.has(entry.id))
      .map(
        (entry): AgentSession => ({
          engine: "codex",
          external: true,
          id: entry.id,
          name: entry.id.slice(0, 8),
          cwd: "",
          status: "seen",
          startedAt: entry.mtime,
        }),
      );
    return [...owned, ...external];
  }
}

interface ClaudeAgent {
  sessionId: string;
  name?: string;
  cwd: string;
  status?: AgentStatus;
  kind?: string;
  startedAt: number;
}

/** No `claude` binary, or an older one without `agents --json`, means no chips. */
async function claudeAgents(): Promise<AgentSession[]> {
  const stdout = await run("claude", ["agents", "--json"], { maxBuffer: 8 * 1024 * 1024 }).then(
    (result) => result.stdout,
    () => null,
  );
  if (!stdout) return [];
  try {
    return (JSON.parse(stdout) as ClaudeAgent[]).map((session) => ({
      engine: "claude",
      external: false,
      id: session.sessionId,
      name: session.name ?? basename(session.cwd),
      cwd: session.cwd,
      status: session.status ?? "idle",
      kind: session.kind,
      startedAt: session.startedAt,
    }));
  } catch {
    return [];
  }
}

const idFromRollout = (file: string) =>
  basename(file).replace(/^rollout-.*?-/, "").replace(/\.jsonl$/, "");

async function recentRollouts(since: number): Promise<{ file: string; mtime: number }[]> {
  const entries = await readdir(SESSIONS, { recursive: true }).catch(() => [] as string[]);
  const files = entries.filter((entry) => entry.endsWith(".jsonl"));
  const stats = await Promise.all(
    files.map(async (file) => ({
      file,
      mtime: (await stat(join(SESSIONS, file)).catch(() => null))?.mtimeMs ?? 0,
    })),
  );
  return stats.filter((entry) => entry.mtime > since);
}
