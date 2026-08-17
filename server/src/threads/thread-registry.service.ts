import { Injectable, Logger, OnApplicationShutdown } from "@nestjs/common";
import type {
  EngineName,
  SafetyMode,
  ThreadEvent,
  ThreadStatus,
  ThreadSummary,
} from "@flightdeck/shared";
import { randomUUID } from "node:crypto";
import type { EmittedEvent, Thread } from "./thread.model";

/** How long to wait for agent children to exit before giving up and logging it. */
const SHUTDOWN_GRACE_MS = 5_000;

export interface ThreadSpec {
  engine: EngineName;
  skill?: string;
  label?: string;
  cwd: string;
  mode?: SafetyMode;
  approvals?: boolean;
  sessionId?: string;
  fork?: boolean;
}

@Injectable()
export class ThreadRegistry implements OnApplicationShutdown {
  private readonly logger = new Logger(ThreadRegistry.name);
  private readonly threads = new Map<string, Thread>();

  create(spec: ThreadSpec): Thread {
    const thread: Thread = {
      id: randomUUID(),
      engine: spec.engine,
      skill: spec.skill ?? "prompt",
      label: spec.label,
      cwd: spec.cwd,
      mode: spec.mode ?? "read",
      approvals: Boolean(spec.approvals),
      sessionId: spec.sessionId,
      fork: Boolean(spec.fork),
      status: "idle",
      startedAt: Date.now(),
      events: [],
      subscribers: new Set(),
      pending: new Map(),
      abort: new AbortController(),
    };
    this.threads.set(thread.id, thread);
    return thread;
  }

  get(id: string): Thread | undefined {
    return this.threads.get(id);
  }

  list(): ThreadSummary[] {
    return [...this.threads.values()]
      .map((thread) => this.summarise(thread))
      .sort((a, b) => b.startedAt - a.startedAt);
  }

  summarise(thread: Thread): ThreadSummary {
    return {
      id: thread.id,
      engine: thread.engine,
      skill: thread.skill,
      label: thread.label,
      cwd: thread.cwd,
      status: thread.status,
      approvals: thread.approvals,
      sessionId: thread.sessionId,
      startedAt: thread.startedAt,
    };
  }

  emit(thread: Thread, event: EmittedEvent): void {
    const stamped = { ...event, ts: Date.now() } as ThreadEvent;
    thread.events.push(stamped);
    for (const send of thread.subscribers) send(stamped);
  }

  setStatus(thread: Thread, status: ThreadStatus): void {
    thread.status = status;
  }

  /** Replay the buffer, then the current status, then everything that follows. */
  subscribe(thread: Thread, send: (event: ThreadEvent) => void): () => void {
    for (const event of thread.events) send(event);
    send({ t: "status", body: thread.status, ts: Date.now() });
    thread.subscribers.add(send);
    return () => thread.subscribers.delete(send);
  }

  stop(id: string): boolean {
    const thread = this.threads.get(id);
    if (!thread || thread.status !== "running") return false;
    this.interrupt(thread);
    thread.status = "stopped";
    thread.stop = undefined;
    this.emit(thread, { t: "turn", body: "stopped" });
    return true;
  }

  private interrupt(thread: Thread): void {
    thread.abort.abort();
    thread.stop?.();
  }

  /**
   * Without this, a SIGTERM leaves every spawned agent running with no parent —
   * the leak the old server had. Nest calls it because `main.ts` enables
   * shutdown hooks.
   *
   * Async on purpose: aborting only *asks* the SDK to stop, and the agent CLI
   * is a child process that needs a moment to die. Returning immediately lets
   * the event loop close first, and the child is reparented to init — exactly
   * the leak this exists to prevent.
   */
  async onApplicationShutdown(signal?: string): Promise<void> {
    const running = [...this.threads.values()].filter((thread) => thread.status === "running");
    if (!running.length) return;
    this.logger.log(`${signal ?? "shutdown"}: reaping ${running.length} running turn(s)`);
    for (const thread of running) this.interrupt(thread);
    await this.drain(running, SHUTDOWN_GRACE_MS);
    const stuck = running.filter((thread) => thread.status === "running");
    if (stuck.length) this.logger.warn(`${stuck.length} turn(s) did not stop within the grace period`);
  }

  private async drain(threads: Thread[], timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (threads.some((thread) => thread.status === "running") && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}
