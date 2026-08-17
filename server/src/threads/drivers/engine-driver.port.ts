import type { EngineName } from "@flightdeck/shared";
import type { TurnContext } from "../thread.model";

/**
 * The one port in the codebase with two genuinely interchangeable
 * implementations. `supportsApprovals` replaces the `engine === "claude"`
 * checks that were previously scattered across the engine and the routes.
 */
export interface EngineDriver {
  readonly engine: EngineName;
  /** Codex `exec` has no approval channel; its safety is the sandbox mode alone. */
  readonly supportsApprovals: boolean;
  run(ctx: TurnContext, prompt: string): Promise<void>;
}

export const ENGINE_DRIVERS = Symbol("ENGINE_DRIVERS");
