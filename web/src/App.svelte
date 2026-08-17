<script lang="ts">
  import { api } from "./lib/api/client";
  import { accounts } from "./lib/state/accounts.svelte";
  import { agents } from "./lib/state/agents.svelte";
  import { prs } from "./lib/state/prs.svelte";
  import { skills } from "./lib/state/skills.svelte";
  import { drawer } from "./lib/state/threads.svelte";
  import { ui } from "./lib/state/ui.svelte";
  import AccountsModal from "./components/accounts/AccountsModal.svelte";
  import Banner from "./components/Banner.svelte";
  import Board from "./components/board/Board.svelte";
  import Drawer from "./components/drawer/Drawer.svelte";
  import Masthead from "./components/Masthead.svelte";
  import RunModal from "./components/run/RunModal.svelte";
  import Tabs from "./components/Tabs.svelte";

  const AGENTS_POLL_MS = 5_000;
  const PRS_POLL_MS = 120_000;

  // Loading the accounts view also loads the board: the PR cache is keyed by
  // login, so the account has to be known first.
  accounts.load();
  skills.load();
  drawer.restore();

  api.health().then((health) => {
    ui.health = health;
    ui.resetBanner();
  }).catch(() => {});

  // Re-reads on every engine switch, because the strip lists one engine at a time.
  $effect(() => {
    ui.engine;
    agents.load();
    const poll = setInterval(() => agents.load(), AGENTS_POLL_MS);
    return () => clearInterval(poll);
  });

  $effect(() => {
    const poll = setInterval(() => prs.load(), PRS_POLL_MS);
    return () => clearInterval(poll);
  });
</script>

<div class="grain" aria-hidden="true"></div>

<Masthead />
<Tabs />

<main>
  <Banner />
  <Board />
</main>

{#if drawer.store}
  <Drawer store={drawer.store} />
{/if}

<RunModal />
<AccountsModal />
