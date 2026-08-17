/**
 * Architecture rules for the Flight Deck workspaces, enforced rather than
 * documented. `pnpm graph:check` fails the build on a violation.
 *
 * The layering is: shared <- server, shared <- web, and nothing else crosses.
 * `shared` is types only, so it must never depend on either side.
 */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment:
        "A cycle means neither module can be understood, tested or moved on its own. Extract the shared part instead.",
      from: {},
      to: { circular: true },
    },
    {
      name: "web-not-to-server",
      severity: "error",
      comment:
        "The browser bundle must never reach into server code — it holds GitHub tokens and spawns processes. They talk over HTTP only.",
      from: { path: "^web/" },
      to: { path: "^server/" },
    },
    {
      name: "server-not-to-web",
      severity: "error",
      comment:
        "The server serves web's build output as static files; importing its source would couple the two and break the published package.",
      from: { path: "^server/" },
      to: { path: "^web/" },
    },
    {
      name: "shared-stays-a-leaf",
      severity: "error",
      comment:
        "shared/ is the contract both sides import. If it depends on either one, it stops being a contract and becomes a cycle.",
      from: { path: "^shared/" },
      to: { path: "^(web|server)/" },
    },
    {
      name: "server-not-to-dev-dep",
      severity: "error",
      comment:
        "server/ is the published npm package: a runtime import of a devDependency resolves on this machine and fails for anyone who installs it. Type-only imports are fine and are ignored here.",
      from: { path: "^server/src", pathNot: "\\.spec\\.ts$" },
      to: {
        dependencyTypes: ["npm-dev"],
        dependencyTypesNot: ["type-only"],
      },
    },
    {
      name: "no-unresolvable",
      severity: "error",
      comment: "An import that does not resolve is a broken module, whatever the typechecker thinks.",
      from: {},
      to: { couldNotResolve: true },
    },
  ],

  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(node_modules|dist|/public/)" },
    tsPreCompilationDeps: true,
    // Each workspace has its own tsconfig; paths resolve per package, so point
    // the resolver at the workspace root and let package.json exports do the rest.
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      extensions: [".ts", ".js", ".mjs", ".cjs", ".json"],
    },
    reporterOptions: {
      dot: { collapsePattern: "node_modules/[^/]+" },
      archi: { collapsePattern: "^(shared|web|server)/[^/]+" },
    },
  },
};
