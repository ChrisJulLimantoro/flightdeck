import { Injectable } from "@nestjs/common";
import type { PrsResponse, PullRequest } from "@flightdeck/shared";
import { AccountsService } from "../accounts/accounts.service";
import { keyedCache } from "../common/keyed-cache";
import { GithubAdapter } from "../github/github.adapter";
import { ReposService } from "../repos/repos.service";
import { SeenService } from "../seen/seen.service";
import { DeriveService } from "./derive.service";

const TTL_MS = 60_000;

@Injectable()
export class PrsService {
  // Keyed by login so switching account can never serve the previous one's rows.
  private readonly cache = keyedCache<PrsResponse>(TTL_MS, () => this.load());

  constructor(
    private readonly github: GithubAdapter,
    private readonly derive: DeriveService,
    private readonly repos: ReposService,
    private readonly seen: SeenService,
    private readonly accounts: AccountsService,
  ) {}

  async list(fresh: boolean): Promise<PrsResponse> {
    const account = await this.accounts.active();
    return this.cache(account.login ?? "gh", fresh);
  }

  private async load(): Promise<PrsResponse> {
    const [viewer, { mine, reviewed }, marks] = await Promise.all([
      this.github.viewer(),
      this.github.pullRequests(),
      this.seen.all(),
    ]);
    return {
      viewer,
      fetchedAt: Date.now(),
      mine: await this.withRepos(this.derive.mine(mine, viewer, marks)),
      reviewed: await this.withRepos(this.derive.reviewed(reviewed, viewer, marks)),
    };
  }

  /**
   * Answer only whether the repo is usable, never where it lives: the checkout
   * path is server-side knowledge the browser has no use for.
   */
  private withRepos(prs: PullRequest[]): Promise<PullRequest[]> {
    return Promise.all(
      prs.map(async (pr) => {
        const { cloned, codexTrusted } = await this.repos.resolve(pr.repo);
        return { ...pr, cloned, codexTrusted };
      }),
    );
  }
}
