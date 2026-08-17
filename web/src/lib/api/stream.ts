import type { ThreadEvent } from "@flightdeck/shared";

/**
 * Subscribe to a thread's SSE feed. The server replays its whole event buffer
 * on connect, so a reload rebuilds the transcript from the first message.
 *
 * Returns the teardown, which callers hand straight back from an `$effect`.
 */
export function streamThread(
  threadId: string,
  onEvent: (event: ThreadEvent) => void,
  onError: () => void,
): () => void {
  const source = new EventSource(`/api/stream/${threadId}`);
  source.onmessage = (message) => onEvent(JSON.parse(message.data) as ThreadEvent);
  source.onerror = onError;
  return () => source.close();
}
