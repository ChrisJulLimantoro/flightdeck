import type { CiState, PrStatus } from "@flightdeck/shared";

export const STATE_LABEL: Record<PrStatus, string> = {
  yours: "CHANGES REQUESTED",
  recheck: "PUSHED SINCE REVIEW",
  "needs-review": "AWAITING REVIEW",
  theirs: "AWAITING RE-REVIEW",
  "in-review": "IN REVIEW",
  "waiting-author": "AWAITING AUTHOR",
  approved: "APPROVED",
  settled: "SETTLED",
  draft: "DRAFT",
};

export const CI_GLYPH: Record<CiState, string> = {
  SUCCESS: "PASS",
  FAILURE: "FAIL",
  ERROR: "ERR",
  PENDING: "RUN",
  NONE: "—",
};

export function ago(ms: number): string {
  const minutes = Math.round((Date.now() - ms) / 60000);
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1440)}d`;
}

export const clockTime = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour12: false });
