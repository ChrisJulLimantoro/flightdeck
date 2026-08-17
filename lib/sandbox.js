import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

const run = promisify(execFile);

const APPARMOR_KNOB = "/proc/sys/kernel/apparmor_restrict_unprivileged_userns";

const BROKEN = {
  ok: false,
  reason: "unprivileged user namespaces are blocked, so Codex's bwrap sandbox cannot start",
  fix: "sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0",
};

// Codex sandboxes every shell command with bwrap, which needs an unprivileged
// user namespace. Ubuntu 24.04+ blocks that by default and the failure surfaces
// as a cryptic `bwrap: setting up uid map` deep inside a run — so probe up front.
async function probe() {
  const restricted = await readFile(APPARMOR_KNOB, "utf8").catch(() => "0");
  if (restricted.trim() !== "1") return { ok: true };
  try {
    await run("unshare", ["--user", "--map-root-user", "true"]);
    return { ok: true };
  } catch {
    return BROKEN;
  }
}

let cache;

export function codexSandbox() {
  cache ??= probe().catch(() => BROKEN);
  return cache;
}
