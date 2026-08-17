import type {
  EngineName,
  SafetyMode,
  ThreadEvent,
  ThreadStatus,
} from "@flightdeck/shared";

/** `Omit` over a union has to distribute, or every variant collapses into one. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** What a producer supplies; the registry stamps `ts` on the way out. */
export type EmittedEvent = DistributiveOmit<ThreadEvent, "ts">;

export interface PendingAsk {
  resolve: (result: PermissionResult) => void;
  timer: NodeJS.Timeout;
  input: unknown;
}

export type PermissionResult =
  | { behavior: "allow"; updatedInput: unknown }
  | { behavior: "deny"; message: string };

/**
 * One engine session across many turns. The event buffer spans all of them, so
 * an SSE subscriber gets the whole conversation on connect.
 */
export interface Thread {
  id: string;
  engine: EngineName;
  skill: string;
  label?: string;
  cwd: string;
  mode: SafetyMode;
  approvals: boolean;
  sessionId?: string;
  fork: boolean;
  status: ThreadStatus;
  startedAt: number;
  events: ThreadEvent[];
  subscribers: Set<(event: ThreadEvent) => void>;
  pending: Map<string, PendingAsk>;
  abort: AbortController;
  /** Set by the active driver for the length of a turn. */
  stop?: () => void;
}

/**
 * The slice of a thread a driver may touch. Drivers emit and adopt sessions
 * through here and never reach into the registry, which is what lets a driver
 * be exercised without one.
 */
export interface TurnContext {
  readonly cwd: string;
  readonly mode: SafetyMode;
  readonly sessionId?: string;
  readonly fork: boolean;
  readonly approvals: boolean;
  readonly abort: AbortController;
  emit(event: EmittedEvent): void;
  /** Called when the engine reports the id we can later resume or hand off. */
  adoptSession(sessionId: string): void;
  askPermission(tool: string, input: unknown): Promise<PermissionResult>;
  /** Register how to interrupt the work this driver just started. */
  onStop(stop: () => void): void;
}
