import { Injectable } from "@nestjs/common";
import type { CiState, PrStatus, PullRequest, ReviewDecision } from "@flightdeck/shared";
import type { RawPullRequest } from "../github/github.adapter";

type Review = { author: { login: string } | null; state: string; submittedAt: string };
type SeenMarks = Record<string, string | undefined>;

const time = (value?: string | null) => (value ? Date.parse(value) : 0);
const latest = (dates: (string | undefined)[]) =>
  dates.reduce((max, date) => Math.max(max, time(date)), 0);

const unresolvedThreads = (pr: RawPullRequest) =>
  pr.reviewThreads.nodes.filter((thread) => !thread.isResolved && !thread.isOutdated).length;

const lastCommit = (pr: RawPullRequest) => time(pr.commits.nodes[0]?.commit.committedDate);
const ciState = (pr: RawPullRequest) =>
  (pr.commits.nodes[0]?.commit.statusCheckRollup?.state ?? "NONE") as CiState;

const submittedReviews = (pr: RawPullRequest, viewer: string) =>
  pr.reviews.nodes.filter((review) => review.author?.login && review.author.login !== viewer);

const reviewersOf = (reviews: Review[]) => [
  ...new Set(reviews.map((review) => review.author!.login)),
];

/** Urgency order: your court first, then unreviewed, then waiting on others. */
const RANK: Record<PrStatus, number> = {
  yours: 0,
  recheck: 0,
  "needs-review": 1,
  theirs: 2,
  "waiting-author": 2,
  "in-review": 3,
  approved: 4,
  settled: 4,
  draft: 5,
};

/**
 * Pure PR-state derivation — no I/O, no dependencies.
 *
 * GitHub has no "is this review solved" field, so every state on the board is
 * inferred here from review timestamps against the last commit.
 */
@Injectable()
export class DeriveService {
  mine(prs: RawPullRequest[], viewer: string, seen: SeenMarks): PullRequest[] {
    return this.derive(prs, viewer, seen, statusOfMine);
  }

  reviewed(prs: RawPullRequest[], viewer: string, seen: SeenMarks): PullRequest[] {
    return this.derive(prs, viewer, seen, statusOfReviewed);
  }

  private derive(
    prs: RawPullRequest[],
    viewer: string,
    seen: SeenMarks,
    statusOf: (pr: RawPullRequest, viewer: string) => PrStatus,
  ): PullRequest[] {
    return prs
      .map((pr) =>
        shape(pr, viewer, statusOf(pr, viewer), seen[`${pr.repository.nameWithOwner}#${pr.number}`]),
      )
      .sort(byUrgency);
  }
}

const byUrgency = (a: PullRequest, b: PullRequest) =>
  RANK[a.status] - RANK[b.status] || b.lastActivityAt - a.lastActivityAt;

function statusOfMine(pr: RawPullRequest, viewer: string): PrStatus {
  const reviews = submittedReviews(pr, viewer);
  const open = unresolvedThreads(pr);
  const contested = pr.reviewDecision === "CHANGES_REQUESTED" || open > 0;
  if (pr.isDraft) return "draft";
  if (!contested && pr.reviewDecision === "APPROVED") return "approved";
  if (contested) {
    return lastCommit(pr) > latest(reviews.map((review) => review.submittedAt))
      ? "theirs"
      : "yours";
  }
  if (reviews.length === 0) return "needs-review";
  return "in-review";
}

function statusOfReviewed(pr: RawPullRequest, viewer: string): PrStatus {
  const mine = pr.reviews.nodes.filter((review) => review.author?.login === viewer);
  if (lastCommit(pr) > latest(mine.map((review) => review.submittedAt))) return "recheck";
  if (unresolvedThreads(pr) > 0) return "waiting-author";
  return "settled";
}

function shape(
  pr: RawPullRequest,
  viewer: string,
  status: PrStatus,
  seenAt: string | undefined,
): PullRequest {
  const reviews = submittedReviews(pr, viewer);
  const lastActivityAt = Math.max(time(pr.updatedAt), lastCommit(pr));
  return {
    id: `${pr.repository.nameWithOwner}#${pr.number}`,
    number: pr.number,
    title: pr.title,
    url: pr.url,
    repo: pr.repository.nameWithOwner,
    author: pr.author?.login ?? "unknown",
    isDraft: pr.isDraft,
    status,
    reviewDecision: (pr.reviewDecision ?? "NONE") as ReviewDecision,
    unresolvedThreads: unresolvedThreads(pr),
    totalThreads: pr.reviewThreads.totalCount,
    reviewers: reviewersOf(reviews),
    ciState: ciState(pr),
    lastCommitAt: lastCommit(pr),
    lastActivityAt,
    createdAt: time(pr.createdAt),
    isNew: lastActivityAt > time(seenAt),
    // Filled in by PrsService once the local checkout is resolved.
    cloned: false,
    codexTrusted: false,
  };
}
