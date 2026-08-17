import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const FILE = join(homedir(), ".ai-dashboard", "auth.json");
const REQUIRED_SCOPE = "repo";

// The gh keyring account is synthesised, never stored with a token: it is
// already org-approved, so it stays as the fallback that always works.
const GH_ACCOUNT = { login: null, source: "gh", scopes: [] };

let state;

async function load() {
  try {
    return JSON.parse(await readFile(FILE, "utf8"));
  } catch {
    return { active: null, accounts: [] };
  }
}

async function save() {
  await mkdir(dirname(FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
  await chmod(FILE, 0o600);
}

async function ghLogin() {
  try {
    return (await run("gh", ["api", "user", "--jq", ".login"])).stdout.trim();
  } catch {
    return null;
  }
}

async function ready() {
  if (state) return state;
  state = await load();
  GH_ACCOUNT.login = await ghLogin();
  state.active ??= GH_ACCOUNT.login;
  return state;
}

const all = () => (GH_ACCOUNT.login ? [GH_ACCOUNT, ...state.accounts] : state.accounts);

export async function accounts() {
  await ready();
  return all();
}

export async function activeAccount() {
  await ready();
  return all().find((account) => account.login === state.active) ?? GH_ACCOUNT;
}

/** Env for shelling out to gh as a given account. The gh account uses the keyring. */
export const ghEnv = (account) =>
  account?.token ? { ...process.env, GH_TOKEN: account.token, GH_HOST: "github.com" } : process.env;

/** Public view: login, source, scopes and a masked tail. Never the token. */
export const publicView = (account) => ({
  login: account.login,
  source: account.source,
  scopes: account.scopes ?? [],
  tail: account.token ? account.token.slice(-4) : null,
});

async function identify(token) {
  const env = { ...process.env, GH_TOKEN: token, GH_HOST: "github.com" };
  const { stdout } = await run("gh", ["api", "user", "--include"], { env });
  const login = JSON.parse(stdout.slice(stdout.indexOf("{"))).login;
  const scopes = stdout.match(/^x-oauth-scopes:\s*(.*)$/im)?.[1] ?? "";
  return { login, scopes: scopes.split(",").map((scope) => scope.trim()).filter(Boolean) };
}

export async function addAccount(token) {
  if (!token?.trim()) throw new Error("token is empty");
  await ready();
  const { login, scopes } = await identify(token.trim()).catch(() => {
    throw new Error("GitHub rejected that token");
  });
  // A token without `repo` authenticates fine and then returns nothing for
  // private PRs — fail loudly here instead of showing an empty board.
  if (!scopes.includes(REQUIRED_SCOPE)) {
    throw new Error(`token is missing the '${REQUIRED_SCOPE}' scope (has: ${scopes.join(", ") || "none"})`);
  }
  if (login === GH_ACCOUNT.login) throw new Error(`${login} is already available via the gh keyring`);
  state.accounts = state.accounts.filter((account) => account.login !== login);
  state.accounts.push({ login, source: "token", token: token.trim(), scopes });
  await save();
  return publicView(state.accounts.at(-1));
}

export async function removeAccount(login) {
  await ready();
  if (login === GH_ACCOUNT.login) throw new Error("the gh keyring account cannot be removed");
  state.accounts = state.accounts.filter((account) => account.login !== login);
  if (state.active === login) state.active = GH_ACCOUNT.login;
  await save();
}

export async function setActive(login) {
  await ready();
  if (!all().some((account) => account.login === login)) throw new Error(`unknown account ${login}`);
  state.active = login;
  await save();
  return login;
}
