import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { activeAccount, ghEnv } from "./accounts.js";

const exec = promisify(execFile);

const PR_FIELDS = `
  number title url isDraft reviewDecision updatedAt createdAt
  author { login }
  repository { nameWithOwner }
  reviews(last: 20) { nodes { author { login } state submittedAt } }
  reviewThreads(first: 50) { totalCount nodes { isResolved isOutdated } }
  commits(last: 1) { nodes { commit { committedDate statusCheckRollup { state } } } }
`;

const query = (search) => `{
  search(query: ${JSON.stringify(search)}, type: ISSUE, first: 50) {
    nodes { ... on PullRequest { ${PR_FIELDS} } }
  }
}`;

// Every gh call runs as the active account: the keyring one uses gh's own
// credentials, a pasted token is injected as GH_TOKEN.
async function gh(args, options = {}) {
  const env = ghEnv(await activeAccount());
  return exec("gh", args, { env, maxBuffer: 16 * 1024 * 1024, ...options });
}

async function search(filter) {
  const { stdout } = await gh(["api", "graphql", "-f", `query=${query(`is:pr is:open ${filter}`)}`]);
  return JSON.parse(stdout).data.search.nodes.filter(Boolean);
}

export const viewer = async () => (await gh(["api", "user", "--jq", ".login"])).stdout.trim();

export const fetchPullRequests = async () => ({
  mine: await search("author:@me"),
  reviewed: await search("reviewed-by:@me -author:@me"),
});
