<script lang="ts">
  import type { SafetyMode } from "@flightdeck/shared";
  import { modals } from "../../lib/state/modals.svelte";
  import { skills } from "../../lib/state/skills.svelte";
  import { drawer } from "../../lib/state/threads.svelte";
  import { ui } from "../../lib/state/ui.svelte";

  let dialog: HTMLDialogElement;

  let skill = $state("");
  let prompt = $state("");
  let write = $state(false);
  let approvals = $state(false);
  let unsandboxed = $state(false);

  // `codex exec` has no approval channel; its safety is the sandbox mode alone.
  const claude = $derived(ui.engine === "claude");

  const mode = $derived<SafetyMode>(unsandboxed ? "unsandboxed" : write ? "write" : "read");

  $effect(() => {
    if (!modals.runFor || !dialog) return;
    skill = "";
    prompt = "";
    write = false;
    approvals = false;
    unsandboxed = false;
    dialog.showModal();
  });

  function run() {
    const pr = modals.runFor;
    if (!pr) return;
    drawer.launch(pr, { skill: skill || undefined, prompt, mode, approvals });
  }
</script>

<dialog class="modal" bind:this={dialog} onclose={() => (modals.runFor = null)}>
  <form method="dialog">
    <h2>RUN ON <span>{modals.runFor ? `#${modals.runFor.number} ${modals.runFor.repo}` : "—"}</span></h2>

    <label>SKILL
      <select bind:value={skill}>
        <option value="">— free-form —</option>
        {#each skills.list as entry (entry.id)}
          <option value={entry.id}>/{entry.id}</option>
        {/each}
      </select>
    </label>

    <label>PROMPT <small>(used when skill is “— free-form —”)</small>
      <textarea rows="4" bind:value={prompt} placeholder="Ask anything about this PR…"></textarea>
    </label>

    <label class="check"><input type="checkbox" bind:checked={write}> ALLOW WRITES</label>

    <label class="check">
      <input type="checkbox" bind:checked={approvals} disabled={!claude}>
      ASK ME BEFORE EACH TOOL CALL
      <small>{claude ? "" : "— not available on Codex"}</small>
    </label>

    {#if ui.sandboxWarning}
      <label class="check"><input type="checkbox" bind:checked={unsandboxed}> RUN UNSANDBOXED</label>
    {/if}

    <p class="modal-note">{ui.sandboxWarning ?? ""}</p>

    <menu>
      <button value="cancel" class="ghost">CANCEL</button>
      <button value="run" class="solid" onclick={run}>RUN</button>
    </menu>
  </form>
</dialog>
