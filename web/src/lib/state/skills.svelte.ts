import type { Skill } from "@flightdeck/shared";
import { api } from "../api/client";

class SkillsState {
  list = $state<Skill[]>([]);

  /** Read once at startup; the server caches the directory scan anyway. */
  async load() {
    this.list = await api.skills().catch(() => []);
  }
}

export const skills = new SkillsState();
