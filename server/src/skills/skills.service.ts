import { Injectable } from "@nestjs/common";
import type { Skill } from "@flightdeck/shared";
import { readFile, readdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// Claude and Codex both read SKILL.md natively, and the two skills directories
// are commonly symlinks to one canonical repo. Resolve through the symlink so
// the repo can move without touching this file.
const CANDIDATES = [join(homedir(), ".codex", "skills"), join(homedir(), ".claude", "skills")];

@Injectable()
export class SkillsService {
  private cache?: Promise<Skill[]>;

  /** No skills directory is a normal state — the `…` dialog just offers none. */
  list(): Promise<Skill[]> {
    this.cache ??= this.load().catch(() => []);
    return this.cache;
  }

  private async load(): Promise<Skill[]> {
    const dir = await skillsDir();
    if (!dir) return [];
    const entries = await readdir(dir, { withFileTypes: true });
    const names = entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name);
    const skills = await Promise.all(names.map((name) => readSkill(dir, name)));
    return skills
      .filter((skill): skill is Skill => Boolean(skill))
      .sort((a, b) => a.id.localeCompare(b.id));
  }
}

async function skillsDir(): Promise<string | null> {
  for (const candidate of CANDIDATES) {
    const resolved = await realpath(candidate).catch(() => null);
    if (resolved) return resolved;
  }
  return null;
}

const field = (frontmatter: string, key: string) =>
  frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1].trim();

/**
 * The directory name is the invocation id — some SKILL.md files carry a
 * Title Case display `name:` that would not resolve as a slash command.
 */
function parse(source: string, id: string): Skill {
  const frontmatter = source.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
  return {
    id,
    name: field(frontmatter, "name") ?? id,
    description: field(frontmatter, "description") ?? "",
    trigger: `/${id}`,
  };
}

async function readSkill(dir: string, id: string): Promise<Skill | undefined> {
  const source = await readFile(join(dir, id, "SKILL.md"), "utf8").catch(() => null);
  return source ? parse(source, id) : undefined;
}
