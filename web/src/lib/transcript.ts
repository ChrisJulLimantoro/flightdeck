import type { ThreadEvent, ThreadEventType } from "@flightdeck/shared";
import { clockTime } from "./format";

export interface TranscriptLine {
  t: ThreadEventType;
  /** Left gutter: a clock time, or a fixed label for the variants that have one. */
  label: string;
  body: string;
  replayed: boolean;
}

const unhandled = (event: never): never => {
  throw new Error(`unhandled thread event ${JSON.stringify(event)}`);
};

/**
 * One event to one transcript line, or null for the variants the transcript
 * renders some other way (`ask`) or not at all (`verdict`, `status`).
 *
 * The switch is exhaustive on purpose: adding a variant to `ThreadEvent` in
 * `shared/` fails to compile here instead of silently rendering nothing.
 */
export function toLine(event: ThreadEvent): TranscriptLine | null {
  const line = (label: string, body: string): TranscriptLine => ({
    t: event.t,
    label,
    body,
    replayed: Boolean(event.replayed),
  });

  switch (event.t) {
    case "ask":
    case "verdict":
    case "status":
      return null;
    case "user":
      return line("YOU", event.body);
    case "turn":
      return line("—", `— ${event.body} —`);
    case "text":
    case "think":
    case "tool":
    case "result":
    case "error":
    case "stderr":
    case "session":
      return line(clockTime(event.ts), event.body);
    default:
      return unhandled(event);
  }
}
