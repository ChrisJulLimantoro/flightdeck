import { Injectable } from "@nestjs/common";
import type { EngineName, SafetyMode } from "@flightdeck/shared";
import { spawn } from "node:child_process";
import type { Readable } from "node:stream";
import type { EmittedEvent, TurnContext } from "../thread.model";
import { contextFileEvent } from "./context-file";
import type { EngineDriver } from "./engine-driver.port";

const MODES: Record<SafetyMode, string> = {
  read: "read-only",
  write: "workspace-write",
  unsandboxed: "danger-full-access",
};

const BWRAP = /bwrap:|Failed RTM_NEWADDR|setting up uid map/;

// codex announces the stdin it will never read; not worth showing.
const NOISE = /Reading additional input from stdin/;

@Injectable()
export class CodexDriver implements EngineDriver {
  readonly engine: EngineName = "codex";
  /** `codex exec` has no approval channel — the sandbox mode is the safety. */
  readonly supportsApprovals = false;

  async run(ctx: TurnContext, prompt: string): Promise<void> {
    ctx.emit(await contextFileEvent(ctx.cwd, "AGENTS.md"));

    const child = spawn("codex", args(ctx, prompt), {
      cwd: ctx.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    ctx.onStop(() => child.kill("SIGTERM"));

    readLines(child.stdout, (line) => {
      const event = parse(line);
      if (event?.t === "session") ctx.adoptSession(event.body);
      else if (event) ctx.emit(event);
    });
    readLines(child.stderr, (line) => {
      if (!NOISE.test(line)) ctx.emit({ t: "stderr", body: line });
    });

    return new Promise<void>((resolve, reject) => {
      child.on("error", (error: NodeJS.ErrnoException) =>
        reject(
          error.code === "ENOENT"
            ? new Error("the codex CLI was not found — install it to use the Codex engine")
            : error,
        ),
      );
      child.on("close", (code) =>
        code === 0 ? resolve() : reject(new Error(`codex exited ${code}`)),
      );
    });
  }
}

/**
 * `codex exec resume` accepts neither -C nor -s, so cwd comes from the child
 * process and the sandbox from a config override — one arg shape for both paths.
 */
function args(ctx: TurnContext, prompt: string): string[] {
  const common = ["--json", "--skip-git-repo-check", "-c", `sandbox_mode="${MODES[ctx.mode]}"`];
  if (!ctx.sessionId) return ["exec", ...common, prompt];
  return ["exec", "resume", ...common, ctx.sessionId, prompt];
}

const ITEMS: Record<string, (item: any) => EmittedEvent | undefined> = {
  agent_message: (item) => ({ t: "text", body: item.text }),
  reasoning: (item) => ({ t: "think", body: item.text }),
  command_execution: (item) => ({ t: "tool", body: item.command }),
  file_change: (item) => ({ t: "tool", body: `edit ${item.path ?? ""}` }),
};

function parse(line: string): EmittedEvent | undefined {
  let event: any;
  try {
    event = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (BWRAP.test(line)) {
    return {
      t: "error",
      body: "codex sandbox failed to start (bwrap/user namespaces blocked) — see the health banner",
    };
  }
  if (event.type === "thread.started") return { t: "session", body: event.thread_id };
  if (event.type === "item.completed") return ITEMS[event.item.type]?.(event.item);
  if (event.type === "turn.failed") {
    return { t: "error", body: event.error?.message ?? "turn failed" };
  }
  if (event.type === "turn.completed") {
    return { t: "result", body: `${event.usage.output_tokens} output tokens` };
  }
  return undefined;
}

function readLines(stream: Readable, onLine: (line: string) => void): void {
  let buffer = "";
  stream.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) onLine(line);
  });
}
