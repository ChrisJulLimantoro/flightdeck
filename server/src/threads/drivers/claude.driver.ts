import { Injectable } from "@nestjs/common";
import type { EngineName, SafetyMode } from "@flightdeck/shared";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { EmittedEvent, TurnContext } from "../thread.model";
import { contextFileEvent } from "./context-file";
import type { EngineDriver } from "./engine-driver.port";

const MODES: Record<SafetyMode, string> = {
  read: "plan",
  write: "acceptEdits",
  unsandboxed: "acceptEdits",
};

@Injectable()
export class ClaudeDriver implements EngineDriver {
  readonly engine: EngineName = "claude";
  readonly supportsApprovals = true;

  async run(ctx: TurnContext, prompt: string): Promise<void> {
    ctx.emit(await contextFileEvent(ctx.cwd, "CLAUDE.md"));

    const session = query({
      prompt,
      options: {
        cwd: ctx.cwd,
        // With approvals on, the mode must stay permissive enough that the SDK
        // actually asks us rather than deciding by itself.
        permissionMode: (ctx.approvals ? "default" : MODES[ctx.mode]) as never,
        canUseTool: ctx.approvals
          ? ((tool: string, input: unknown) => ctx.askPermission(tool, input) as never)
          : undefined,
        resume: ctx.sessionId,
        forkSession: ctx.fork,
        abortController: ctx.abort,
        // Pinned rather than relied upon: the SDK loads all filesystem settings
        // when this is omitted, but earlier versions defaulted to none, and
        // 'project' is what pulls in the repo's CLAUDE.md.
        settingSources: ["user", "project", "local"],
      },
    });

    ctx.onStop(() => session.interrupt?.());

    for await (const message of session) {
      const event = claudeEvent(message);
      if (event?.t === "session") ctx.adoptSession(event.body);
      else if (event) ctx.emit(event);
    }
  }
}

function assistantEvent(content: any[]): EmittedEvent | undefined {
  const text = content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
  if (text.trim()) return { t: "text", body: text };
  const tool = content.find((block) => block.type === "tool_use");
  return tool ? { t: "tool", body: tool.name } : undefined;
}

function claudeEvent(message: any): EmittedEvent | undefined {
  if (message.type === "system" && message.subtype === "init") {
    return { t: "session", body: message.session_id };
  }
  if (message.type === "assistant") return assistantEvent(message.message.content);
  if (message.type === "result") return { t: "result", body: message.result ?? message.subtype };
  return undefined;
}
