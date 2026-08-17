import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const SESSIONS = join(homedir(), ".codex", "sessions");
const RECENT_MS = 30 * 60 * 1000;

// Codex sessions we spawned ourselves: sessionId -> { cwd, name, status }
export const ownedCodex = new Map();

const chip = (fields) => ({ engine: "claude", external: false, ...fields });

async function claudeAgents() {
  try {
    const { stdout } = await run("claude", ["agents", "--json"], { maxBuffer: 8 * 1024 * 1024 });
    return JSON.parse(stdout).map((session) =>
      chip({
        id: session.sessionId,
        name: session.name ?? basename(session.cwd),
        cwd: session.cwd,
        status: session.status ?? "idle",
        kind: session.kind,
        startedAt: session.startedAt,
      }),
    );
  } catch {
    return [];
  }
}

const idFromRollout = (file) => basename(file).replace(/^rollout-.*?-/, "").replace(/\.jsonl$/, "");

// Codex has no `agents --json`. Reconstruct: sessions we own, plus rollout
// files touched recently (marked external — we cannot see their real status).
async function recentRollouts(since) {
  try {
    const entries = await readdir(SESSIONS, { recursive: true });
    const files = entries.filter((entry) => entry.endsWith(".jsonl"));
    const stats = await Promise.all(
      files.map(async (file) => ({ file, mtime: (await stat(join(SESSIONS, file))).mtimeMs })),
    );
    return stats.filter((entry) => entry.mtime > since);
  } catch {
    return [];
  }
}

async function codexAgents() {
  const owned = [...ownedCodex.entries()].map(([id, session]) => ({
    engine: "codex",
    external: false,
    id,
    ...session,
  }));
  const ownedIds = new Set(ownedCodex.keys());
  const external = (await recentRollouts(Date.now() - RECENT_MS))
    .map((entry) => ({ id: idFromRollout(entry.file), mtime: entry.mtime }))
    .filter((entry) => !ownedIds.has(entry.id))
    .map((entry) => ({
      engine: "codex",
      external: true,
      id: entry.id,
      name: entry.id.slice(0, 8),
      cwd: "",
      status: "seen",
      startedAt: entry.mtime,
    }));
  return [...owned, ...external];
}

export const listAgents = async () => ({
  claude: await claudeAgents(),
  codex: await codexAgents(),
});
