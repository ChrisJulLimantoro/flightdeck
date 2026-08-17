import { Injectable } from "@nestjs/common";
import { readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { ConfigService } from "../config/config.service";

export interface ResolvedRepo {
  path?: string;
  cloned: boolean;
  codexTrusted: boolean;
}

const HOME = homedir();
const CODEX_CONFIG = join(HOME, ".codex", "config.toml");

/** How deep below a root a checkout may sit: ~/repo, ~/org/repo, ~/work/org/repo. */
const MAX_DEPTH = 3;

const SKIP = new Set(["node_modules", "Library", "Applications", "snap", "go"]);

// git@github.com:OWNER/REPO.git | https://github.com/OWNER/REPO(.git)
const slugOf = (url: string) =>
  url.trim().replace(/\.git$/, "").match(/[:/]([^:/]+\/[^:/]+)$/)?.[1];

@Injectable()
export class ReposService {
  private cache?: Promise<{ paths: Map<string, string>; trusted: Set<string> }>;

  constructor(private readonly config: ConfigService) {}

  async resolve(slug: string): Promise<ResolvedRepo> {
    const { paths, trusted } = await this.index();
    const path = paths.get(slug);
    return { path, cloned: Boolean(path), codexTrusted: Boolean(path && trusted.has(path)) };
  }

  private index() {
    this.cache ??= Promise.all([this.scan(), trustedByCodex()]).then(([paths, trusted]) => ({
      paths,
      trusted,
    }));
    return this.cache;
  }

  /** Drop the cached index so a newly cloned repo is picked up. */
  refresh() {
    this.cache = undefined;
  }

  /**
   * Find local checkouts with no configuration at all.
   *
   * `$HOME` walked to a bounded depth costs tens of milliseconds and finds the
   * `~/work/client/repo` layouts a fixed list of roots misses. `scanRoots` is
   * only an escape hatch for checkouts living outside $HOME, and explicit
   * `repos` overrides win over anything discovered.
   */
  private async scan(): Promise<Map<string, string>> {
    const index = new Map<string, string>();
    const roots = [HOME, ...(await this.config.scanRoots())];

    for (const root of roots) {
      for (const path of await gitDirs(root, MAX_DEPTH)) {
        const slug = await originSlug(path);
        if (slug && !index.has(slug)) index.set(slug, path);
      }
    }

    for (const [slug, path] of Object.entries(await this.config.repoOverrides())) {
      if (isAbsolute(path)) index.set(slug, resolve(path));
    }
    return index;
  }
}

/** Directories containing a `.git`, without descending into repos themselves. */
async function gitDirs(root: string, depth: number): Promise<string[]> {
  if (depth < 0) return [];
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  if (entries.some((entry) => entry.name === ".git")) return [root];

  const children = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && !SKIP.has(entry.name))
    .map((entry) => join(root, entry.name));

  const found = await Promise.all(children.map((child) => gitDirs(child, depth - 1)));
  return found.flat();
}

/**
 * Read the origin URL out of `.git/config` rather than spawning `git remote`
 * once per candidate — a file read instead of ~30 subprocesses per scan.
 *
 * Never infer a path from the repo name: `foo` and `foo-main` can both exist
 * locally and only the remote says which is which.
 */
async function originSlug(path: string): Promise<string | undefined> {
  const config = await readFile(join(await gitDir(path), "config"), "utf8").catch(() => null);
  if (!config) return undefined;
  const url = config.match(/\[remote "origin"\][^[]*?url\s*=\s*(.+)/)?.[1];
  return url ? slugOf(url) : undefined;
}

/** `.git` is a file in worktrees and submodules, pointing at the real gitdir. */
async function gitDir(path: string): Promise<string> {
  const dotGit = join(path, ".git");
  const stats = await stat(dotGit).catch(() => null);
  if (!stats?.isFile()) return dotGit;
  const pointer = await readFile(dotGit, "utf8").catch(() => "");
  const target = pointer.match(/^gitdir:\s*(.+)$/m)?.[1]?.trim();
  if (!target) return dotGit;
  return isAbsolute(target) ? target : join(path, target);
}

/** Codex refuses to run in a project that is not trusted in its config. */
async function trustedByCodex(): Promise<Set<string>> {
  const config = await readFile(CODEX_CONFIG, "utf8").catch(() => "");
  return new Set([...config.matchAll(/\[projects\."([^"]+)"\]/g)].map((match) => match[1]));
}
