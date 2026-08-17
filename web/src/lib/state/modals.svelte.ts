import type { PullRequest } from "@flightdeck/shared";

/** Which dialog is showing. Both are singletons, so this is the whole model. */
class ModalState {
  runFor = $state<PullRequest | null>(null);
  accountsOpen = $state(false);
}

export const modals = new ModalState();
