import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const HOME = homedir();
const ROOTS = [join(HOME, "glair"), join(HOME, "personal")];
const CODEX_CONFIG = join(HOME, ".codex", "config.toml");

// git@github.com:OWNER/REPO.git | https://github.com/OWNER/REPO(.git)
const slugOf = (url) => url.trim().replace(/\.git$/, "").match(/[:/]([^:/]+\/[^:/]+)$/)?.[1];

async function originSlug(path) {
  try {
    const { stdout } = await run("git", ["-C", path, "remote", "get-url", "origin"]);
    return slugOf(stdout);
  } catch {
    return undefined;
  }
}

async function childDirs(root) {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => join(root, entry.name));
  } catch {
    return [];
  }
}

// Never infer a path from the repo name: glair-vision-engineering and
// glair-vision-engineering-main both exist locally. Ask git instead.
async function scan() {
  const index = new Map();
  for (const root of ROOTS) {
    for (const path of await childDirs(root)) {
      const slug = await originSlug(path);
      if (slug && !index.has(slug)) index.set(slug, path);
    }
  }
  return index;
}

async function trustedByCodex() {
  try {
    const config = await readFile(CODEX_CONFIG, "utf8");
    return new Set([...config.matchAll(/\[projects\."([^"]+)"\]/g)].map((match) => match[1]));
  } catch {
    return new Set();
  }
}

let cache;

export async function repoIndex() {
  cache ??= Promise.all([scan(), trustedByCodex()]).then(([paths, trusted]) => ({ paths, trusted }));
  return cache;
}

export async function resolveRepo(slug) {
  const { paths, trusted } = await repoIndex();
  const path = paths.get(slug);
  return { path, cloned: Boolean(path), codexTrusted: Boolean(path && trusted.has(path)) };
}
