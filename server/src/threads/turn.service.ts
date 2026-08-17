import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import type { ThreadStatus } from "@flightdeck/shared";
import { AgentsService } from "../agents/agents.service";
import { ApprovalService } from "./approval.service";
import { ENGINE_DRIVERS, type EngineDriver } from "./drivers/engine-driver.port";
import type { Thread, TurnContext } from "./thread.model";
import { ThreadRegistry, type ThreadSpec } from "./thread-registry.service";

@Injectable()
export class TurnService {
  constructor(
    @Inject(ENGINE_DRIVERS) private readonly drivers: EngineDriver[],
    private readonly registry: ThreadRegistry,
    private readonly approvals: ApprovalService,
    private readonly agents: AgentsService,
  ) {}

  /** Approvals are only honoured by drivers that have a channel for them. */
  create(spec: ThreadSpec): Thread {
    const driver = this.driverFor(spec.engine);
    return this.registry.create({
      ...spec,
      approvals: Boolean(spec.approvals) && driver.supportsApprovals,
    });
  }

  start(thread: Thread, prompt: string): Thread {
    if (thread.status === "running") throw new BadRequestException("that thread is still running");
    const driver = this.driverFor(thread.engine);

    // Codex has no listing API, so a session we start is only visible in the
    // strip because we record it here.
    if (thread.engine === "codex" && !thread.sessionId) this.trackCodex(thread, thread.id, "starting");

    this.registry.setStatus(thread, "running");
    this.registry.emit(thread, { t: "user", body: prompt });

    driver
      .run(this.context(thread), prompt)
      .then(() => this.settle(thread, "idle"))
      .catch((error: Error) => {
        this.registry.emit(thread, { t: "error", body: error.message });
        this.settle(thread, "failed");
      });

    return thread;
  }

  private driverFor(engine: string): EngineDriver {
    const driver = this.drivers.find((candidate) => candidate.engine === engine);
    if (!driver) throw new BadRequestException("unknown engine");
    return driver;
  }

  private context(thread: Thread): TurnContext {
    return {
      cwd: thread.cwd,
      mode: thread.mode,
      sessionId: thread.sessionId,
      fork: thread.fork,
      approvals: thread.approvals,
      abort: thread.abort,
      emit: (event) => this.registry.emit(thread, event),
      adoptSession: (sessionId) => this.adoptSession(thread, sessionId),
      askPermission: (tool, input) => this.approvals.ask(thread, tool, input),
      onStop: (stop) => {
        thread.stop = stop;
      },
    };
  }

  private adoptSession(thread: Thread, sessionId: string): void {
    if (thread.sessionId === sessionId) return;
    thread.sessionId = sessionId;
    this.registry.emit(thread, { t: "session", body: sessionId });
    if (thread.engine !== "codex") return;
    // The placeholder keyed by thread id gives way to the real session id.
    this.agents.disown(thread.id);
    this.trackCodex(thread, sessionId, "running");
  }

  private settle(thread: Thread, status: ThreadStatus): void {
    // A stop already settled this thread; don't overwrite that with the
    // driver's own resolution.
    if (thread.status !== "running") return;
    this.registry.setStatus(thread, status);
    thread.stop = undefined;
    this.registry.emit(thread, { t: "turn", body: status });
    if (thread.engine === "codex" && thread.sessionId) {
      this.trackCodex(thread, thread.sessionId, status);
    }
  }

  private trackCodex(thread: Thread, id: string, status: ThreadStatus | "starting"): void {
    this.agents.own(id, {
      cwd: thread.cwd,
      name: thread.skill,
      status,
      startedAt: thread.startedAt,
    });
  }
}
