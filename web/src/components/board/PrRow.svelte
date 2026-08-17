<script lang="ts">
  import type { PullRequest } from "@flightdeck/shared";
  import { CI_GLYPH, STATE_LABEL, ago } from "../../lib/format";
  import { prs } from "../../lib/state/prs.svelte";
  import RowActions from "./RowActions.svelte";

  let { pr, index }: { pr: PullRequest; index: number } = $props();

  const shortRepo = $derived(pr.repo.split("/")[1]);
</script>

<!--
  Clicking anywhere on the row clears its "something happened" pip. The row is
  not itself a control — the title link and the action buttons are, and both
  reach the same behaviour from the keyboard.
-->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="row"
  data-status={pr.status}
  style="animation-delay: {index * 18}ms"
  onclick={() => prs.markSeen(pr)}
>
  <div class="bar"></div>

  <div class="slug"><b>#{pr.number}</b> {shortRepo}</div>

  <div class="title">
    <span class="pip" class:hide={!pr.isNew}></span>
    <a href={pr.url} target="_blank" rel="noreferrer">{pr.title}</a>
  </div>

  <div class="state">{STATE_LABEL[pr.status] ?? pr.status}</div>
  <div class="num" class:hot={pr.unresolvedThreads > 0}>{pr.unresolvedThreads}</div>
  <div class="ci" data-ci={pr.ciState}>{CI_GLYPH[pr.ciState] ?? pr.ciState}</div>
  <div class="age">{ago(pr.lastActivityAt)}</div>

  <RowActions {pr} />
</div>
