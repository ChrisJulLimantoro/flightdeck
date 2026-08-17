import type { AgentSession } from "@flightdeck/shared";
import { api } from "../api/client";
import { ui } from "./ui.svelte";

class AgentsState {
  sessions = $state<AgentSession[]>([]);

  /** The strip is decoration; never break the board over it. */
  async load() {
    try {
      const all = await api.agents();
      this.sessions = all[ui.engine] ?? [];
    } catch {
      /* leave the last known list in place */
    }
  }
}

export const agents = new AgentsState();
