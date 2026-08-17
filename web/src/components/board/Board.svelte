<script lang="ts">
  import { prs } from "../../lib/state/prs.svelte";
  import PrRow from "./PrRow.svelte";

  const COLUMNS = ["", "REPO", "TITLE", "STATE", "OPEN", "CI", "AGE", ""];
</script>

<section class="board">
  {#if !prs.rows.length}
    <div class="empty-note">NOTHING HERE. GO WRITE SOME CODE.</div>
  {:else}
    <div class="row head">
      {#each COLUMNS as column, index (index)}<div>{column}</div>{/each}
    </div>
    {#each prs.rows as pr, index (pr.id)}
      <PrRow {pr} {index} />
    {/each}
  {/if}
</section>
