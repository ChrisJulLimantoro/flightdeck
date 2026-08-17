import { BadRequestException, Injectable } from "@nestjs/common";
import type { AccountView, AccountsResponse } from "@flightdeck/shared";
import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { STATE_DIR, stateFile } from "../common/state-dir";

const run = promisify(execFile);
const FILE = stateFile("auth.json");
const REQUIRED_SCOPE = "repo";

export interface Account {
  login: string | null;
  source: "gh" | "token";
  scopes: string[];
  token?: string;
}

interface AuthState {
  active: string | null;
  accounts: Account[];
}

@Injectable()
export class AccountsService {
  /**
   * The gh keyring account is synthesised, never stored with a token: it is
   * already org-approved, so it stays as the fallback that always works.
   */
  private readonly ghAccount: Account = { login: null, source: "gh", scopes: [] };
  private state?: AuthState;

  async all(): Promise<Account[]> {
    await this.ready();
    return this.list();
  }

  async active(): Promise<Account> {
    const state = await this.ready();
    return this.list().find((account) => account.login === state.active) ?? this.ghAccount;
  }

  async view(): Promise<AccountsResponse> {
    return {
      active: (await this.active()).login,
      accounts: (await this.all()).map(publicView),
    };
  }

  /** Env for shelling out to gh as an account. The gh account uses the keyring. */
  env(account: Account): NodeJS.ProcessEnv {
    if (!account.token) return process.env;
    return { ...process.env, GH_TOKEN: account.token, GH_HOST: "github.com" };
  }

  async add(token: string): Promise<void> {
    if (!token?.trim()) throw new BadRequestException("token is empty");
    const state = await this.ready();
    const { login, scopes } = await identify(token.trim()).catch(() => {
      throw new BadRequestException("GitHub rejected that token");
    });
    // A token without `repo` authenticates fine and then returns nothing for
    // private PRs — fail loudly here instead of showing an empty board.
    if (!scopes.includes(REQUIRED_SCOPE)) {
      throw new BadRequestException(
        `token is missing the '${REQUIRED_SCOPE}' scope (has: ${scopes.join(", ") || "none"})`,
      );
    }
    if (login === this.ghAccount.login) {
      throw new BadRequestException(`${login} is already available via the gh keyring`);
    }
    state.accounts = state.accounts.filter((account) => account.login !== login);
    state.accounts.push({ login, source: "token", token: token.trim(), scopes });
    await this.save();
  }

  async remove(login: string): Promise<void> {
    const state = await this.ready();
    if (login === this.ghAccount.login) {
      throw new BadRequestException("the gh keyring account cannot be removed");
    }
    state.accounts = state.accounts.filter((account) => account.login !== login);
    if (state.active === login) state.active = this.ghAccount.login;
    await this.save();
  }

  async setActive(login: string): Promise<void> {
    const state = await this.ready();
    if (!this.list().some((account) => account.login === login)) {
      throw new BadRequestException(`unknown account ${login}`);
    }
    state.active = login;
    await this.save();
  }

  private list(): Account[] {
    const stored = this.state?.accounts ?? [];
    return this.ghAccount.login ? [this.ghAccount, ...stored] : stored;
  }

  private async ready(): Promise<AuthState> {
    if (this.state) return this.state;
    this.state = await load();
    this.ghAccount.login = await ghLogin();
    this.state.active ??= this.ghAccount.login;
    return this.state;
  }

  private async save(): Promise<void> {
    await mkdir(STATE_DIR, { recursive: true });
    await writeFile(FILE, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    await chmod(FILE, 0o600);
  }
}

/** Public view: login, source, scopes and a masked tail. Never the token. */
export const publicView = (account: Account): AccountView => ({
  login: account.login,
  source: account.source,
  scopes: account.scopes ?? [],
  tail: account.token ? account.token.slice(-4) : null,
});

async function load(): Promise<AuthState> {
  return readFile(FILE, "utf8").then(
    (source) => JSON.parse(source) as AuthState,
    () => ({ active: null, accounts: [] }),
  );
}

/** No `gh` on the machine is a supported state: the board just has no viewer. */
async function ghLogin(): Promise<string | null> {
  return run("gh", ["api", "user", "--jq", ".login"]).then(
    ({ stdout }) => stdout.trim(),
    () => null,
  );
}

async function identify(token: string): Promise<{ login: string; scopes: string[] }> {
  const env = { ...process.env, GH_TOKEN: token, GH_HOST: "github.com" };
  const { stdout } = await run("gh", ["api", "user", "--include"], { env });
  const login = (JSON.parse(stdout.slice(stdout.indexOf("{"))) as { login: string }).login;
  const scopes = stdout.match(/^x-oauth-scopes:\s*(.*)$/im)?.[1] ?? "";
  return { login, scopes: scopes.split(",").map((scope) => scope.trim()).filter(Boolean) };
}
