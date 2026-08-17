import type {
  AgentSession,
  Decision,
  EngineName,
  PullRequest,
  SafetyMode,
  ThreadEvent,
  ThreadStatus,
  ThreadSummary,
  Verdict,
} from "@flightdeck/shared";
import { api } from "../api/client";
import { prs } from "./prs.svelte";
import { ui } from "./ui.svelte";

const LAST_THREAD = "lastThread";

const HANDOFF: Record<EngineName, (cwd: string, sessionId: string) => string> = {
  claude: (cwd, sessionId) => `cd ${cwd} && claude --resume ${sessionId}`,
  codex: (cwd, sessionId) => `cd ${cwd} && codex resume ${sessionId}`,
};

/**
 * One open thread: its append-only event buffer and everything derived from it.
 *
 * Resolved approvals are read out of the buffer rather than tracked separately,
 * so the prompt cannot disagree with the transcript it is rendered inside.
 */
export class ThreadStore {
  readonly id: string;
  readonly engine: EngineName;
  readonly skill: string;
  readonly title: string;
  readonly cwd: string;

  events = $state<ThreadEvent[]>([]);
  status = $state<ThreadStatus>("idle");
  sessionId = $state<string | undefined>(undefined);

  verdicts = $derived(
    new Map(
      this.events.flatMap((event): [string, Verdict][] =>
        event.t === "verdict" ? [[event.askId, event.body]] : [],
      ),
    ),
  );

  running = $derived(this.status === "running");

  constructor(thread: ThreadSummary, title?: string) {
    this.id = thread.id;
    this.engine = thread.engine;
    this.skill = thread.skill;
    this.title = title ?? thread.label ?? thread.id;
    this.cwd = thread.cwd ?? "";
    this.status = thread.status;
    this.sessionId = thread.sessionId;
  }

  append(event: ThreadEvent) {
    if (event.t === "status" || event.t === "turn") this.status = event.body;
    // The POST that opened the drawer answers before the engine reports its
    // session id, so HAND OFF only works if the stream fills it in later.
    if (event.t === "session") this.sessionId = event.body;
    if (event.t !== "status") this.events.push(event);
  }

  handoffCommand(): string | null {
    if (!this.sessionId) return null;
    return HANDOFF[this.engine](this.cwd, this.sessionId);
  }

  async send(prompt: string) {
    this.status = "running";
    try {
      await api.turn(this.id, { prompt });
    } catch (error) {
      ui.notify(`SEND FAILED — ${(error as Error).message}`);
      this.status = "idle";
    }
  }

  decide(askId: string, decision: Decision) {
    api.permission(this.id, { askId, decision }).catch((error: Error) => ui.notify(error.message));
  }

  stop() {
    api.stop(this.id).catch(() => {});
  }
}

export interface LaunchOptions {
  skill?: string;
  prompt?: string;
  mode?: SafetyMode;
  approvals?: boolean;
}

class DrawerState {
  store = $state<ThreadStore | null>(null);

  private open(thread: ThreadSummary, title?: string) {
    this.store = new ThreadStore(thread, title);
    localStorage.setItem(LAST_THREAD, thread.id);
  }

  close() {
    this.store = null;
    localStorage.removeItem(LAST_THREAD);
  }

  async launch(pr: PullRequest, { skill, prompt, mode = "read", approvals = false }: LaunchOptions) {
    const blocked = prs.blockReason(pr);
    if (blocked) return ui.notify(blocked);
    if (skill === "pr-review" && !confirm(`/pr-review posts review comments to ${pr.repo}#${pr.number}. Continue?`)) return;
    if (mode === "unsandboxed" && !confirm("Unsandboxed means the agent runs shell commands with no isolation. Continue?")) return;
    try {
      const thread = await api.createThread({
        engine: ui.engine,
        skill,
        prompt,
        target: pr.url,
        repo: pr.repo,
        mode,
        approvals,
      });
      this.open(thread, `#${pr.number} ${pr.repo}`);
    } catch (error) {
      ui.notify(`LAUNCH FAILED — ${(error as Error).message}`);
    }
  }

  /**
   * A session busy in a terminal already has a driver, so forking gives it its
   * own branch instead of interleaving two of them.
   */
  async openSession(session: AgentSession) {
    try {
      const fork = session.status === "busy" || session.external;
      const thread = await api.openSession(ui.engine, session.id, { fork });
      this.open(thread, session.name);
      if (fork) ui.notify(`${session.name} is live elsewhere — replies will FORK it into a new branch.`);
    } catch (error) {
      ui.notify(`CANNOT OPEN SESSION — ${(error as Error).message}`);
    }
  }

  /** A reload re-attaches to the last thread: the server keeps its event buffer. */
  async restore() {
    const id = localStorage.getItem(LAST_THREAD);
    if (!id) return;
    const thread = (await api.threads().catch(() => [])).find((entry) => entry.id === id);
    if (thread) this.open(thread);
  }
}

export const drawer = new DrawerState();
