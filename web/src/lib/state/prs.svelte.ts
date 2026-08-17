import type { PrsResponse, PullRequest } from "@flightdeck/shared";
import { api } from "../api/client";
import { ui } from "./ui.svelte";

class PrsState {
  data = $state<PrsResponse | null>(null);

  rows = $derived(this.data?.[ui.tab] ?? []);
  mineCount = $derived(this.data?.mine.length ?? 0);
  reviewedCount = $derived(this.data?.reviewed.length ?? 0);
  fetchedLabel = $derived(
    this.data ? `SYNCED ${new Date(this.data.fetchedAt).toLocaleTimeString()}` : "—",
  );

  async load(fresh = false) {
    try {
      this.data = await api.prs(fresh);
      ui.resetBanner();
    } catch (error) {
      ui.notify(`PR FETCH FAILED — ${(error as Error).message}`);
    }
  }

  /** The pip clears optimistically; a failed stamp is not worth a banner. */
  async markSeen(pr: PullRequest) {
    if (!pr.isNew) return;
    pr.isNew = false;
    await api.markSeen({ id: pr.id }).catch(() => {});
  }

  /** Why a row's action buttons are disabled, or null when it can run. */
  blockReason(pr: PullRequest): string | null {
    if (!pr.cloned) return `${pr.repo} is not cloned locally`;
    if (ui.engine === "codex" && !pr.codexTrusted) return `${pr.repo} is not a trusted Codex project`;
    return null;
  }
}

export const prs = new PrsState();
