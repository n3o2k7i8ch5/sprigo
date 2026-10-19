// Pure retry loop (tested by src/retry.test.ts).

/** Runs `fn` up to `tries` times, retrying only errors `again` accepts; the last error is thrown. */
export async function retry<T>(fn: () => Promise<T>, again: (e: unknown) => boolean, tries = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try { return await fn(); }
    catch (e) { if (i >= tries || !again(e)) throw e; }
  }
}

/** Runs `fn` with `first`; when that fails (after its own retries) and there is a `backup` and `may()`, tells `onSwitch`
 *  and runs it once more with the backup (#36). The backup's error is the one thrown. */
export async function withBackup<C, T>(first: C, backup: C | null, fn: (c: C) => Promise<T>, onSwitch: (c: C) => void, may = () => true): Promise<T> {
  try { return await fn(first); }
  catch (e) { if (!backup || !may()) throw e; onSwitch(backup); return fn(backup); }
}
