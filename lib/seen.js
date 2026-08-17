import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const FILE = join(homedir(), ".ai-dashboard", "seen.json");

let state;

export async function seen() {
  if (state) return state;
  try {
    state = JSON.parse(await readFile(FILE, "utf8"));
  } catch {
    state = {};
  }
  return state;
}

export async function markSeen(id) {
  const current = await seen();
  current[id] = new Date().toISOString();
  await mkdir(dirname(FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify(current, null, 2));
  return current[id];
}
