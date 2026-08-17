# CLAUDE.md

The working notes for this repo are engine-agnostic and live in one place, so the two files cannot
drift apart:

@AGENTS.md

## Claude-specific notes

- **Skills in this repo** live in `.claude/skills/`. `/verify-contract` checks a backend change
  against the live HTTP contract; `/add-engine` walks the driver-port steps for a new engine. Prefer
  them over re-deriving those workflows.
- **The server spawns Claude.** `ClaudeDriver` calls the agent SDK's `query()`, so a Flight Deck run
  starts a real `claude` process in the target repo. When testing here, expect nested sessions and
  keep prompts cheap.
- `ClaudeDriver` pins `settingSources: ["user", "project", "local"]`. That is what loads a target
  repo's `CLAUDE.md`. It is pinned rather than left default because earlier SDK versions defaulted to
  loading nothing — do not "simplify" it away.
- Approvals only work on Claude: `canUseTool` is the SDK's channel and `codex exec` has no
  equivalent. `supportsApprovals` on the driver is the single source of truth for that difference.
