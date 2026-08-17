<script lang="ts">
  import { agents } from "../../lib/state/agents.svelte";
  import { drawer } from "../../lib/state/threads.svelte";
  import { ui } from "../../lib/state/ui.svelte";

  const tail = (cwd: string) => cwd.split("/").pop() ?? "";
</script>

<div class="strip">
  <span class="strip-label">LIVE SESSIONS — CLICK TO OPEN</span>
  <div class="chips">
    {#if !agents.sessions.length}
      <div class="chip empty">no live {ui.engine} sessions</div>
    {:else}
      {#each agents.sessions as session (session.id)}
        <button
          class="chip"
          data-status={session.status}
          title={session.status === "busy"
            ? "busy in another terminal — opens read-only"
            : `open ${session.id}`}
          onclick={() => drawer.openSession(session)}
        >
          <span class="dot"></span><b>{session.name}</b>{tail(session.cwd)}
          {#if session.external}<span class="ext">EXT</span>{/if}
        </button>
      {/each}
    {/if}
  </div>
</div>
