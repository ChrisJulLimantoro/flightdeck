const time = (value) => (value ? Date.parse(value) : 0);
const latest = (dates) => dates.reduce((max, date) => Math.max(max, time(date)), 0);

const unresolvedThreads = (pr) =>
  pr.reviewThreads.nodes.filter((thread) => !thread.isResolved && !thread.isOutdated).length;

const lastCommit = (pr) => time(pr.commits.nodes[0]?.commit.committedDate);
const ciState = (pr) => pr.commits.nodes[0]?.commit.statusCheckRollup?.state ?? "NONE";

const submittedReviews = (pr, viewer) =>
  pr.reviews.nodes.filter((review) => review.author?.login && review.author.login !== viewer);

const reviewersOf = (reviews) => [...new Set(reviews.map((review) => review.author.login))];

// GitHub has no "review is solved" field. These are the derived answers.
function statusOfMine(pr, viewer) {
  const reviews = submittedReviews(pr, viewer);
  const open = unresolvedThreads(pr);
  const contested = pr.reviewDecision === "CHANGES_REQUESTED" || open > 0;
  if (pr.isDraft) return "draft";
  if (!contested && pr.reviewDecision === "APPROVED") return "approved";
  if (contested) return lastCommit(pr) > latest(reviews.map((r) => r.submittedAt)) ? "theirs" : "yours";
  if (reviews.length === 0) return "needs-review";
  return "in-review";
}

function statusOfReviewed(pr, viewer) {
  const mine = pr.reviews.nodes.filter((review) => review.author?.login === viewer);
  if (lastCommit(pr) > latest(mine.map((review) => review.submittedAt))) return "recheck";
  if (unresolvedThreads(pr) > 0) return "waiting-author";
  return "settled";
}

function shape(pr, viewer, status, seenAt) {
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
    reviewDecision: pr.reviewDecision ?? "NONE",
    unresolvedThreads: unresolvedThreads(pr),
    totalThreads: pr.reviewThreads.totalCount,
    reviewers: reviewersOf(reviews),
    ciState: ciState(pr),
    lastCommitAt: lastCommit(pr),
    lastActivityAt,
    createdAt: time(pr.createdAt),
    isNew: lastActivityAt > time(seenAt),
  };
}

const RANK = {
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

const byUrgency = (a, b) =>
  RANK[a.status] - RANK[b.status] || b.lastActivityAt - a.lastActivityAt;

const derive = (prs, viewer, seen, statusOf) =>
  prs.map((pr) => shape(pr, viewer, statusOf(pr, viewer), seen[`${pr.repository.nameWithOwner}#${pr.number}`]))
    .sort(byUrgency);

export const deriveMine = (prs, viewer, seen) => derive(prs, viewer, seen, statusOfMine);
export const deriveReviewed = (prs, viewer, seen) => derive(prs, viewer, seen, statusOfReviewed);
