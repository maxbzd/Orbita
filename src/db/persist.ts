/** Storage durability: the browser may evict IndexedDB of a site that is not "persistent". */

/** Asks the browser not to evict the data. Resolves to whether storage is persistent now. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    return (await navigator.storage.persisted()) || (await navigator.storage.persist());
  } catch {
    return false;
  }
}

export interface StorageEstimate {
  usageBytes: number;
  quotaBytes: number;
}

/** Bytes used and available for this origin, where the browser can tell. */
export async function estimateStorage(): Promise<StorageEstimate | null> {
  try {
    if (!navigator.storage?.estimate) return null;
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return { usageBytes: usage, quotaBytes: quota };
  } catch {
    return null;
  }
}
