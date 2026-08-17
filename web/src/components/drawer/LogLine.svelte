<script lang="ts">
  import type { TranscriptLine } from "../../lib/transcript";

  let { line }: { line: TranscriptLine } = $props();
</script>

<div class="line" data-t={line.t} class:replayed={line.replayed}>
  <span class="t">{line.label}</span>
  <span class="b">{line.body}</span>
</div>
