<script lang="ts">
  import { streamThread } from "../../lib/api/stream";
  import { drawer, type ThreadStore } from "../../lib/state/threads.svelte";
  import { ui } from "../../lib/state/ui.svelte";
  import ReplyBox from "./ReplyBox.svelte";
  import Transcript from "./Transcript.svelte";

  let { store }: { store: ThreadStore } = $props();

  let elapsed = $state(0);

  // Both the stream and the timer tear themselves down when the thread changes
  // or the drawer closes, so neither can outlive the session it belongs to.
  $effect(() => streamThread(store.id, (event) => store.append(event), () => {}));

  $effect(() => {
    if (!store.running) return;
    const from = Date.now();
    elapsed = 0;
    const ticker = setInterval(() => (elapsed = Math.round((Date.now() - from) / 1000)), 1000);
    return () => clearInterval(ticker);
  });

  function handOff() {
    const command = store.handoffCommand();
    if (!command) return ui.notify("no session id yet — wait for the first turn");
    navigator.clipboard?.writeText(command).catch(() => {});
    ui.notify(`COPIED — ${command}`);
  }
</script>

<aside class="drawer">
  <div class="drawer-head">
    <span class="badge">{store.engine.toUpperCase()}</span>
    <span class="drawer-title">/{store.skill} · {store.title}</span>
    <span class="drawer-state" data-status={store.status}>{store.status.toUpperCase()}</span>
    <span class="drawer-timer">{store.running ? `${elapsed}s` : ""}</span>
    <button class="ghost" onclick={handOff}>HAND OFF</button>
    <button class="ghost" onclick={() => store.stop()}>STOP</button>
    <button class="ghost" onclick={() => drawer.close()}>CLOSE</button>
  </div>

  <Transcript {store} />
  <ReplyBox {store} />
</aside>
