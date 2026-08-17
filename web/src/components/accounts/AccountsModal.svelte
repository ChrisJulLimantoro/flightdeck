<script lang="ts">
  import { accounts } from "../../lib/state/accounts.svelte";
  import { modals } from "../../lib/state/modals.svelte";

  let dialog: HTMLDialogElement;
  let token = $state("");

  $effect(() => {
    if (!dialog) return;
    if (modals.accountsOpen) dialog.showModal();
    else dialog.close();
  });

  async function add(event: SubmitEvent) {
    event.preventDefault();
    await accounts.add(token);
    token = "";
  }
</script>

<dialog class="modal" bind:this={dialog} onclose={() => (modals.accountsOpen = false)}>
  <h2>GITHUB ACCOUNTS</h2>

  <div>
    {#each accounts.list as account (account.login)}
      <div class="account">
        <!-- The gh keyring account has no login until `gh auth login` has run. -->
        <button
          class="account-pick"
          class:is-active={account.login === accounts.active}
          disabled={!account.login}
          onclick={() => account.login && accounts.select(account.login)}
        >{account.login ?? "gh — not signed in"}</button>

        <span class="account-meta">
          {account.source === "gh" ? "gh keyring" : `token ••••${account.tail}`}
        </span>

        {#if account.scopes.length}
          <span class="account-meta">{account.scopes.join(" ")}</span>
        {/if}

        {#if account.source !== "gh"}
          <button class="ghost" onclick={() => accounts.remove(account.login ?? "")}>REMOVE</button>
        {/if}
      </div>
    {/each}
  </div>

  <form onsubmit={add}>
    <label>ADD A PERSONAL ACCESS TOKEN
      <input type="password" bind:value={token} placeholder="ghp_…" autocomplete="off">
    </label>

    <p class="modal-note" id="accounts-note">
      {#if accounts.error}
        {accounts.error}
      {:else}
        Needs the <b>repo</b> scope. Create one at github.com/settings/tokens — classic tokens work;
        a fine-grained token may need org approval before it can see private repos.
      {/if}
    </p>

    <menu>
      <button type="button" class="ghost" onclick={() => (modals.accountsOpen = false)}>CLOSE</button>
      <button type="submit" class="solid">ADD</button>
    </menu>
  </form>
</dialog>
