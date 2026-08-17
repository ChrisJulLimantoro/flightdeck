import { Injectable } from "@nestjs/common";
import type { SandboxProbe } from "@flightdeck/shared";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

const run = promisify(execFile);

const APPARMOR_KNOB = "/proc/sys/kernel/apparmor_restrict_unprivileged_userns";

const BROKEN: SandboxProbe = {
  ok: false,
  reason: "unprivileged user namespaces are blocked, so Codex's bwrap sandbox cannot start",
  fix: "sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0",
};

@Injectable()
export class SandboxService {
  private cache?: Promise<SandboxProbe>;

  /**
   * Codex sandboxes every shell command with bwrap, which needs an unprivileged
   * user namespace. Ubuntu 24.04+ blocks that by default and the failure only
   * surfaces as a cryptic `bwrap: setting up uid map` deep inside a run — so
   * probe up front and let the UI warn before anything is launched.
   */
  probe(): Promise<SandboxProbe> {
    this.cache ??= this.run().catch(() => BROKEN);
    return this.cache;
  }

  private async run(): Promise<SandboxProbe> {
    const restricted = await readFile(APPARMOR_KNOB, "utf8").catch(() => "0");
    if (restricted.trim() !== "1") return { ok: true };
    try {
      await run("unshare", ["--user", "--map-root-user", "true"]);
      return { ok: true };
    } catch {
      return BROKEN;
    }
  }
}
