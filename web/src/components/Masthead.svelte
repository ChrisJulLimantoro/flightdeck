<script lang="ts">
  import type { EngineName } from "@flightdeck/shared";
  import { accounts } from "../lib/state/accounts.svelte";
  import { modals } from "../lib/state/modals.svelte";
  import { ui } from "../lib/state/ui.svelte";
  import SessionStrip from "./agents/SessionStrip.svelte";

  const ENGINES: EngineName[] = ["claude", "codex"];
</script>

<header class="masthead">
  <div class="brand">
    <h1>FLIGHT<span>DECK</span></h1>
    <button class="sub" title="Switch GitHub account" onclick={() => (modals.accountsOpen = true)}>
      {accounts.label}
    </button>
  </div>

  <SessionStrip />

  <div class="engine" role="group" aria-label="Engine">
    {#each ENGINES as engine (engine)}
      <button
        class="engine-btn"
        class:is-active={ui.engine === engine}
        onclick={() => ui.selectEngine(engine)}
      >{engine.toUpperCase()}</button>
    {/each}
  </div>

  <div class="rule"></div>
</header>
