import { readdir, readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// Claude and Codex both read SKILL.md natively, and on this machine both
// ~/.claude/skills and ~/.codex/skills symlink to the same canonical directory.
// Resolve through the symlink so the repo can move without touching this file.
const CANDIDATES = [join(homedir(), ".codex", "skills"), join(homedir(), ".claude", "skills")];

async function skillsDir() {
  for (const candidate of CANDIDATES) {
    try {
      return await realpath(candidate);
    } catch {
      continue;
    }
  }
  throw new Error("no skills directory found (~/.codex/skills or ~/.claude/skills)");
}

const field = (frontmatter, key) =>
  frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1].trim();

// The directory name is the invocation id — some SKILL.md files carry a
// Title Case display `name:` that would not resolve as a slash command.
function parse(source, id) {
  const frontmatter = source.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
  return {
    id,
    name: field(frontmatter, "name") ?? id,
    description: field(frontmatter, "description") ?? "",
    trigger: `/${id}`,
  };
}

async function readSkill(dir, id) {
  try {
    return parse(await readFile(join(dir, id, "SKILL.md"), "utf8"), id);
  } catch {
    return undefined;
  }
}

let cache;

export async function listSkills() {
  cache ??= (async () => {
    const dir = await skillsDir();
    const entries = await readdir(dir, { withFileTypes: true });
    const names = entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).map((entry) => entry.name);
    const skills = await Promise.all(names.map((name) => readSkill(dir, name)));
    return skills.filter(Boolean).sort((a, b) => a.id.localeCompare(b.id));
  })();
  return cache;
}
