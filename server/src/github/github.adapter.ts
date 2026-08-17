import { BadRequestException, Injectable } from "@nestjs/common";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AccountsService } from "../accounts/accounts.service";

const exec = promisify(execFile);

const PR_FIELDS = `
  number title url isDraft reviewDecision updatedAt createdAt
  author { login }
  repository { nameWithOwner }
  reviews(last: 20) { nodes { author { login } state submittedAt } }
  reviewThreads(first: 50) { totalCount nodes { isResolved isOutdated } }
  commits(last: 1) { nodes { commit { committedDate statusCheckRollup { state } } } }
`;

const query = (search: string) => `{
  search(query: ${JSON.stringify(search)}, type: ISSUE, first: 50) {
    nodes { ... on PullRequest { ${PR_FIELDS} } }
  }
}`;

/** The raw GraphQL node shape; DeriveService is what gives it meaning. */
export interface RawPullRequest {
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  reviewDecision: string | null;
  updatedAt: string;
  createdAt: string;
  author: { login: string } | null;
  repository: { nameWithOwner: string };
  reviews: { nodes: { author: { login: string } | null; state: string; submittedAt: string }[] };
  reviewThreads: { totalCount: number; nodes: { isResolved: boolean; isOutdated: boolean }[] };
  commits: {
    nodes: { commit: { committedDate: string; statusCheckRollup: { state: string } | null } }[];
  };
}

@Injectable()
export class GithubAdapter {
  constructor(private readonly accounts: AccountsService) {}

  async viewer(): Promise<string> {
    const { stdout } = await this.gh(["api", "user", "--jq", ".login"]);
    return stdout.trim();
  }

  async pullRequests(): Promise<{ mine: RawPullRequest[]; reviewed: RawPullRequest[] }> {
    return {
      mine: await this.search("author:@me"),
      reviewed: await this.search("reviewed-by:@me -author:@me"),
    };
  }

  private async search(filter: string): Promise<RawPullRequest[]> {
    const { stdout } = await this.gh([
      "api",
      "graphql",
      "-f",
      `query=${query(`is:pr is:open ${filter}`)}`,
    ]);
    const body = JSON.parse(stdout) as { data: { search: { nodes: (RawPullRequest | null)[] } } };
    return body.data.search.nodes.filter((node): node is RawPullRequest => Boolean(node));
  }

  /**
   * Every gh call runs as the active account: the keyring one uses gh's own
   * credentials, a pasted token is injected as GH_TOKEN.
   *
   * A missing `gh` binary is the most likely first-run failure for someone who
   * installed this from npm, so it gets a message that says what to do.
   */
  private async gh(args: string[]) {
    const account = await this.accounts.active();
    try {
      return await exec("gh", args, {
        env: this.accounts.env(account),
        maxBuffer: 16 * 1024 * 1024,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new BadRequestException(
          "the GitHub CLI (gh) was not found — install it and run `gh auth login`",
        );
      }
      throw error;
    }
  }
}
