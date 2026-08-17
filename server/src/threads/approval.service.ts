import { Injectable } from "@nestjs/common";
import type { Verdict } from "@flightdeck/shared";
import { randomUUID } from "node:crypto";
import type { PermissionResult, Thread } from "./thread.model";
import { ThreadRegistry } from "./thread-registry.service";

const ASK_TIMEOUT_MS = 120_000;

const VERDICTS: Record<Verdict, (input: unknown) => PermissionResult> = {
  allow: (input) => ({ behavior: "allow", updatedInput: input }),
  deny: () => ({ behavior: "deny", message: "denied by the operator in Flight Deck" }),
  timeout: () => ({ behavior: "deny", message: "no answer within 120s — auto-denied" }),
};

/** Parks a tool call until the operator answers, or 120s passes. */
@Injectable()
export class ApprovalService {
  constructor(private readonly registry: ThreadRegistry) {}

  ask(thread: Thread, tool: string, input: unknown): Promise<PermissionResult> {
    const askId = randomUUID();
    this.registry.emit(thread, {
      t: "ask",
      askId,
      tool,
      body: JSON.stringify(input).slice(0, 400),
    });
    return new Promise<PermissionResult>((resolve) => {
      // A closed tab must never wedge a session: unanswered asks auto-deny.
      const timer = setTimeout(() => this.resolve(thread, askId, "timeout"), ASK_TIMEOUT_MS);
      thread.pending.set(askId, { resolve, timer, input });
    });
  }

  resolve(thread: Thread, askId: string, decision: Verdict): boolean {
    const ask = thread.pending.get(askId);
    if (!ask) return false;
    clearTimeout(ask.timer);
    thread.pending.delete(askId);
    this.registry.emit(thread, { t: "verdict", askId, body: decision });
    ask.resolve(VERDICTS[decision](ask.input));
    return true;
  }
}
