/**
 * A per-key TTL cache over an async loader.
 *
 * Keyed because the PR list is per GitHub account: switching accounts must
 * never serve the previous account's rows. A rejected load evicts itself so a
 * transient failure is not cached.
 */
export function keyedCache<T>(ttlMs: number, load: (key: string) => Promise<T>) {
  const entries = new Map<string, { at: number; value: Promise<T> }>();

  return (key: string, force = false): Promise<T> => {
    const hit = entries.get(key);
    if (!force && hit && Date.now() - hit.at < ttlMs) return hit.value;
    const value = load(key).catch((error: unknown) => {
      entries.delete(key);
      throw error;
    });
    entries.set(key, { at: Date.now(), value });
    return value;
  };
}
