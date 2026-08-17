<script lang="ts">
  import type { ThreadStore } from "../../lib/state/threads.svelte";

  let { store }: { store: ThreadStore } = $props();

  let text = $state("");

  const placeholder = $derived(
    store.running
      ? "running — wait for the turn to finish…"
      : "Reply to this session…  (Enter to send, Shift+Enter for newline)",
  );

  function send(event: Event) {
    event.preventDefault();
    const prompt = text.trim();
    if (!prompt) return;
    text = "";
    store.send(prompt);
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey) send(event);
  }
</script>

<form class="reply" onsubmit={send}>
  <textarea
    rows="1"
    bind:value={text}
    disabled={store.running}
    {placeholder}
    {onkeydown}
  ></textarea>
  <button class="solid" type="submit" disabled={store.running}>SEND</button>
</form>
