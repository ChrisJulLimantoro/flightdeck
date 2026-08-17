/**
 * The wire contract between `lib/engine.js` and the web client.
 *
 * Every variant here is transcribed from an `emit()` call site in `lib/engine.js`
 * or a mapper in `lib/transcript.js`. Adding a variant on the server without
 * handling it in the client is now a compile error rather than a silent no-op.
 */

export type EngineName = "claude" | "codex";

/** Safety mode picked at launch; maps per engine in `MODES` (lib/engine.js:12). */
export type SafetyMode = "read" | "write" | "unsandboxed";

/** Thread lifecycle, from `createThread` and every `settle()` call. */
export type ThreadStatus = "idle" | "running" | "failed" | "stopped";

/** `timeout` is the server's own verdict when an ask goes unanswered for 120s. */
export type Verdict = "allow" | "deny" | "timeout";

/** Decisions the client is allowed to send back; `timeout` is server-only. */
export type Decision = Extract<Verdict, "allow" | "deny">;

/** Variants whose `body` is free text and which render as one transcript line. */
export type TextEventType =
  | "text"
  | "think"
  | "tool"
  | "result"
  | "error"
  | "stderr"
  | "user";

type Stamped = {
  ts: number;
  /** Set by `adoptThread` on events replayed from an on-disk transcript. */
  replayed?: boolean;
};

export type ThreadEvent = Stamped &
  (
    | { t: TextEventType; body: string }
    | { t: "session"; body: string }
    | { t: "turn"; body: ThreadStatus }
    | { t: "status"; body: ThreadStatus }
    | { t: "ask"; askId: string; tool: string; body: string }
    | { t: "verdict"; askId: string; body: Verdict }
  );

export type ThreadEventType = ThreadEvent["t"];

export type AskEvent = Extract<ThreadEvent, { t: "ask" }>;
