import type { EngineName, Health, PrTab } from "@flightdeck/shared";

/** Engine choice, tab choice, the banner line, and the Codex sandbox probe. */
class UiState {
  engine = $state<EngineName>("claude");
  tab = $state<PrTab>("mine");
  banner = $state<string | null>(null);
  health = $state<Health | null>(null);

  /** Codex sandboxes every shell command with bwrap; warn before a run dies mid-way. */
  sandboxWarning = $derived.by(() => {
    const codex = this.health?.codexSandbox;
    if (this.engine !== "codex" || !codex || codex.ok) return null;
    return `CODEX SANDBOX UNAVAILABLE — ${codex.reason}. FIX: ${codex.fix} — or tick UNSANDBOXED in the “…” dialog.`;
  });

  notify(message: string | null) {
    this.banner = message;
  }

  /** Drop a transient message back to whatever the sandbox probe has to say. */
  resetBanner() {
    this.banner = this.sandboxWarning;
  }

  selectEngine(engine: EngineName) {
    this.engine = engine;
    this.resetBanner();
  }
}

export const ui = new UiState();
