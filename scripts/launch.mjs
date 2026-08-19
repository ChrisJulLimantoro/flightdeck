#!/usr/bin/env node
// One command to get from a fresh clone to a running Flight Deck: install what
// is missing, build only when sources moved, start the server, open the board.
// There is no test suite here, so this is also the fastest way to eyeball a change.
import { spawn } from "node:child_process";
import { existsSync, statSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const flags = new Set(process.argv.slice(2));
const port = Number(process.env.PORT ?? 4321);
const url = `http://127.0.0.1:${port}`;

const SOURCE_DIRS = ["shared/src", "web/src", "server/src"];
const BUILD_OUTPUTS = ["server/dist/main.js", "server/public/index.html"];

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
    child.on("error", () => reject(new Error(`could not run \`${command}\` — is it installed and on PATH?`)));
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`\`${command} ${args.join(" ")}\` failed`))));
  });
}

function newestMtime(path) {
  const stats = statSync(path);
  if (!stats.isDirectory()) return stats.mtimeMs;
  const children = readdirSync(path).map((name) => newestMtime(join(path, name)));
  return Math.max(stats.mtimeMs, ...children, 0);
}

function mtimeOr(path, fallback) {
  if (!existsSync(path)) return fallback;
  return newestMtime(path);
}

function needsBuild() {
  if (flags.has("--build")) return true;
  if (BUILD_OUTPUTS.some((output) => !existsSync(join(root, output)))) return true;
  const built = Math.min(...BUILD_OUTPUTS.map((output) => mtimeOr(join(root, output), 0)));
  return SOURCE_DIRS.some((dir) => mtimeOr(join(root, dir), 0) > built);
}

async function ensureDependencies() {
  if (existsSync(join(root, "node_modules")) && !flags.has("--install")) return;
  console.log("→ installing dependencies");
  await run("pnpm", ["install"]);
}

async function ensureBuild() {
  if (!needsBuild()) return;
  console.log("→ building web + server");
  await run("pnpm", ["build"]);
}

function openerFor(platform) {
  if (platform === "darwin") return { command: "open", args: [url] };
  if (platform === "win32") return { command: "cmd", args: ["/c", "start", "", url] };
  return { command: "xdg-open", args: [url] };
}

// Best effort only: a headless box or a missing opener must not fail the launch.
function openBrowser() {
  if (flags.has("--no-open")) return;
  const { command, args } = openerFor(process.platform);
  const child = spawn(command, args, { stdio: "ignore", detached: true });
  child.on("error", () => {});
  child.unref();
}

async function waitForServer(attempts = 60) {
  if (attempts === 0) return;
  const reachable = await fetch(url).then(() => true).catch(() => false);
  if (reachable) return openBrowser();
  await new Promise((resolve) => setTimeout(resolve, 250));
  return waitForServer(attempts - 1);
}

async function start() {
  console.log(`→ starting flight deck on ${url}`);
  void waitForServer();
  await run("pnpm", ["start"]);
}

async function main() {
  await ensureDependencies();
  await ensureBuild();
  await start();
}

main().catch((error) => {
  console.error(`flight deck: ${error.message}`);
  process.exit(1);
});
