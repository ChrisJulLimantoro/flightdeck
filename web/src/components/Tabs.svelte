<script lang="ts">
  import { prs } from "../lib/state/prs.svelte";
  import { ui } from "../lib/state/ui.svelte";
</script>

<nav class="tabs">
  <button class="tab" class:is-active={ui.tab === "mine"} onclick={() => (ui.tab = "mine")}>
    MINE <b>{prs.mineCount}</b>
  </button>
  <button class="tab" class:is-active={ui.tab === "reviewed"} onclick={() => (ui.tab = "reviewed")}>
    REVIEWED BY ME <b>{prs.reviewedCount}</b>
  </button>
  <span class="spacer"></span>
  <span class="meta">{prs.fetchedLabel}</span>
  <button class="ghost" onclick={() => prs.load(true)}>REFRESH</button>
</nav>
