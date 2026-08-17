import { copyFile, chmod, mkdir, readdir, rename, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const STATE_DIR = join(homedir(), ".flightdeck");

/** Where Flight Deck kept its state before the rename. */
const LEGACY_DIR = join(homedir(), ".ai-dashboard");

const exists = (path: string) => stat(path).then(() => true, () => false);

/**
 * Move `~/.ai-dashboard` to `~/.flightdeck` once, before anything reads it.
 *
 * `auth.json` holds GitHub tokens at mode 600 and `seen.json` every last-seen
 * mark, so skipping this would silently orphan both. `rename` is atomic within
 * a filesystem and preserves the mode; the copy fallback is for the case where
 * the two paths straddle a mount.
 */
export async function migrateStateDir(): Promise<void> {
  if (await exists(STATE_DIR)) return;
  if (!(await exists(LEGACY_DIR))) return;
  try {
    await rename(LEGACY_DIR, STATE_DIR);
  } catch {
    await copyTree(LEGACY_DIR, STATE_DIR);
  }
}

async function copyTree(from: string, to: string): Promise<void> {
  await mkdir(to, { recursive: true });
  for (const entry of await readdir(from, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const target = join(to, entry.name);
    await copyFile(join(from, entry.name), target);
    // auth.json carries tokens; never widen its permissions in transit.
    await chmod(target, 0o600);
  }
}

export const stateFile = (name: string) => join(STATE_DIR, name);
