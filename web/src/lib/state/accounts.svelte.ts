import type { AccountsResponse } from "@flightdeck/shared";
import { api } from "../api/client";
import { prs } from "./prs.svelte";

class AccountsState {
  data = $state<AccountsResponse | null>(null);
  error = $state("");

  active = $derived(this.data?.active ?? "");
  list = $derived(this.data?.accounts ?? []);
  label = $derived(this.data ? `@${this.data.active}` : "—");

  /**
   * Every account mutation answers with the whole view, and the PR cache is
   * keyed by login — so re-query rather than reuse rows from the old account.
   */
  private async apply(pending: Promise<AccountsResponse>) {
    try {
      this.data = await pending;
      this.error = "";
      await prs.load(true);
    } catch (error) {
      this.error = (error as Error).message.toUpperCase();
    }
  }

  load = () => this.apply(api.accounts());
  select = (login: string) => this.apply(api.setActiveAccount({ login }));
  add = (token: string) => this.apply(api.addAccount({ token }));
  remove = (login: string) => this.apply(api.removeAccount(login));
}

export const accounts = new AccountsState();
