<script lang="ts">
  import type { ThreadStore } from "../../lib/state/threads.svelte";
  import { toLine } from "../../lib/transcript";
  import ApprovalPrompt from "./ApprovalPrompt.svelte";
  import LogLine from "./LogLine.svelte";

  let { store }: { store: ThreadStore } = $props();

  let log: HTMLDivElement;
  let pinned = true;

  // Read the scroll position *before* the append lands, so a reader who has
  // scrolled up to look at something is not yanked back to the bottom.
  $effect.pre(() => {
    store.events.length;
    if (log) pinned = log.scrollTop + log.clientHeight >= log.scrollHeight - 40;
  });

  $effect(() => {
    store.events.length;
    if (log && pinned) log.scrollTop = log.scrollHeight;
  });
</script>

<div class="log" bind:this={log}>
  {#each store.events as event, index (index)}
    {#if event.t === "ask"}
      <ApprovalPrompt
        {event}
        verdict={store.verdicts.get(event.askId)}
        decide={(askId, decision) => store.decide(askId, decision)}
      />
    {:else}
      {@const line = toLine(event)}
      {#if line}<LogLine {line} />{/if}
    {/if}
  {/each}
</div>
