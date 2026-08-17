import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { EmittedEvent } from "../thread.model";

/**
 * Report which project context file the agent will pick up in this directory.
 *
 * Both engines load their own file implicitly from `cwd` — Claude reads
 * CLAUDE.md via its project settings, Codex reads AGENTS.md natively — which
 * makes it invisible whether the repo's instructions are actually in play.
 * Saying so in the transcript turns that into something you can check.
 */
export async function contextFileEvent(cwd: string, name: string): Promise<EmittedEvent> {
  const found = await stat(join(cwd, name)).then(
    (stats) => stats.isFile(),
    () => false,
  );
  return {
    t: "tool",
    body: found ? `context: ${name}` : `context: no ${name} in this repo`,
  };
}
