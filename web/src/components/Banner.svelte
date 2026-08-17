<script lang="ts">
  import { ui } from "../lib/state/ui.svelte";
</script>

{#if ui.banner}
  <div class="banner">{ui.banner}</div>
{/if}
