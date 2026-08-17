<script lang="ts">
  import type { PullRequest } from "@flightdeck/shared";
  import { modals } from "../../lib/state/modals.svelte";
  import { prs } from "../../lib/state/prs.svelte";
  import { drawer } from "../../lib/state/threads.svelte";
  import { ui } from "../../lib/state/ui.svelte";

  let { pr }: { pr: PullRequest } = $props();

  /** A null skill opens the run dialog instead of launching straight away. */
  const ACTIONS: [label: string, skill: string | null][] = [
    ["FEEDBACK", "pr-feedback"],
    ["REVIEW", "pr-review"],
    ["…", null],
  ];

  const blocked = $derived(prs.blockReason(pr));

  function activate(event: MouseEvent, skill: string | null) {
    event.stopPropagation();
    if (skill) drawer.launch(pr, { skill });
    else modals.runFor = pr;
  }
</script>

<div class="acts">
  {#each ACTIONS as [label, skill] (label)}
    <button
      class="act"
      disabled={Boolean(blocked)}
      title={blocked ?? `${ui.engine} · /${skill ?? "choose a skill"}`}
      onclick={(event) => activate(event, skill)}
    >{label}</button>
  {/each}
</div>
