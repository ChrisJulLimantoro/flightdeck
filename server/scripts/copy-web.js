/**
 * Copy the built SPA into the server package.
 *
 * The server serves `server/public` in every context — working tree and
 * published tarball alike — so there is exactly one asset path to reason about
 * and `files` can ship the SPA without reaching outside the package.
 */
const { cpSync, existsSync, rmSync } = require("node:fs");
const { join } = require("node:path");

const from = join(__dirname, "..", "..", "web", "dist");
const to = join(__dirname, "..", "public");

if (!existsSync(from)) {
  console.log("web/dist not built — skipping SPA copy");
  process.exit(0);
}

rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true });
console.log(`copied ${from} -> ${to}`);
