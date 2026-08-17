<script lang="ts">
  import type { AskEvent, Decision, Verdict } from "@flightdeck/shared";

  let {
    event,
    verdict,
    decide,
  }: {
    event: AskEvent;
    /** Read out of the transcript, so it can never disagree with it. */
    verdict: Verdict | undefined;
    decide: (askId: string, decision: Decision) => void;
  } = $props();

  const DECISIONS: Decision[] = ["allow", "deny"];
</script>

<div class="ask" class:is-resolved={Boolean(verdict)} data-verdict={verdict}>
  <div class="ask-tool">{event.tool} wants to run</div>
  <pre class="ask-input">{event.body}</pre>
  <div class="ask-menu">
    {#if verdict}
      <span class="ask-verdict">{verdict.toUpperCase()}</span>
    {:else}
      {#each DECISIONS as decision (decision)}
        <button class="act" onclick={() => decide(event.askId, decision)}>
          {decision.toUpperCase()}
        </button>
      {/each}
    {/if}
  </div>
</div>
