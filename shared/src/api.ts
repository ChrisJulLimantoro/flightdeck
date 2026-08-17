/**
 * Shapes of the JSON the routes in `server.js` return and accept. Each type
 * names the function that produces it, so the two stay checkable against
 * each other by reading rather than by guessing.
 */

import type { Decision, EngineName, SafetyMode, ThreadStatus } from "./events.js";

/* ---------- pull requests (lib/derive.js) ---------- */

/** The keys of `RANK` in lib/derive.js — the derived answer GitHub does not give. */
export type PrStatus =
  | "yours"
  | "recheck"
  | "needs-review"
  | "theirs"
  | "waiting-author"
  | "in-review"
  | "approved"
  | "settled"
  | "draft";

export type CiState = "SUCCESS" | "FAILURE" | "ERROR" | "PENDING" | "NONE";

export type ReviewDecision = "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | "NONE";

/** `shape()` in lib/derive.js, then `withRepo()` in server.js merges the repo fields. */
export interface PullRequest {
  id: string;
  number: number;
  title: string;
  url: string;
  repo: string;
  author: string;
  isDraft: boolean;
  status: PrStatus;
  reviewDecision: ReviewDecision;
  unresolvedThreads: number;
  totalThreads: number;
  reviewers: string[];
  ciState: CiState;
  lastCommitAt: number;
  lastActivityAt: number;
  createdAt: number;
  isNew: boolean;
  cloned: boolean;
  codexTrusted: boolean;
  /**
   * TODO(nest): the absolute local checkout path currently leaks to the browser
   * because `withRepo` spreads all of `resolveRepo`. The PrsController DTO
   * should drop it — the client never reads it.
   */
  path?: string;
}

export interface PrsResponse {
  viewer: string;
  fetchedAt: number;
  mine: PullRequest[];
  reviewed: PullRequest[];
}

export type PrTab = "mine" | "reviewed";

/* ---------- threads (lib/engine.js) ---------- */

/** `summarise()` in lib/engine.js. */
export interface ThreadSummary {
  id: string;
  engine: EngineName;
  skill: string;
  label?: string;
  cwd?: string;
  status: ThreadStatus;
  approvals: boolean;
  sessionId?: string;
  startedAt: number;
}

export interface CreateThreadRequest {
  engine: EngineName;
  skill?: string;
  prompt?: string;
  target?: string;
  repo: string;
  mode: SafetyMode;
  approvals: boolean;
}

export interface TurnRequest {
  prompt: string;
}

export interface PermissionRequest {
  askId: string;
  decision: Decision;
}

export interface OpenSessionRequest {
  fork: boolean;
}

/* ---------- live sessions (lib/agents.js) ---------- */

/**
 * Claude reports its own status verbatim from `claude agents --json`; Codex
 * statuses come from `ownedCodex`, or `seen` for a rollout file we did not start.
 */
export type AgentStatus = ThreadStatus | "busy" | "starting" | "seen";

export interface AgentSession {
  engine: EngineName;
  external: boolean;
  id: string;
  name: string;
  cwd: string;
  status: AgentStatus;
  kind?: string;
  startedAt: number;
}

export type AgentsResponse = Record<EngineName, AgentSession[]>;

/* ---------- skills, accounts, health ---------- */

/** `parse()` in lib/skills.js. */
export interface Skill {
  id: string;
  name: string;
  description: string;
  trigger: string;
}

/**
 * `publicView` in the accounts service — never carries the token itself.
 *
 * `login` is null when the `gh` CLI is absent or logged out: the synthesised
 * keyring account still exists, it just has no identity to show.
 */
export interface AccountView {
  login: string | null;
  source: "gh" | "token";
  scopes: string[];
  tail: string | null;
}

export interface AccountsResponse {
  active: string | null;
  accounts: AccountView[];
}

export interface AddAccountRequest {
  token: string;
}

export interface SetActiveAccountRequest {
  login: string;
}

/** `codexSandbox()` in lib/sandbox.js. */
export type SandboxProbe = { ok: true } | { ok: false; reason: string; fix: string };

export interface Health {
  codexSandbox: SandboxProbe;
}

export interface SeenRequest {
  id: string;
}
