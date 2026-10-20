/** The slice of the Screen Wake Lock API used here. */
export interface WakeLockSentinelLike {
  release(): Promise<void>;
}
export interface WakeLockApi {
  request(type: 'screen'): Promise<WakeLockSentinelLike>;
}
export interface VisibilityTarget {
  readonly visibilityState: string;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

/**
 * Keeps the screen on while a recording runs, so a phone on a walk does not lock itself and cut
 * the microphone. Browsers drop the lock when the page is hidden; it is taken again on return.
 * Never fails: where the API is missing or refuses, recording simply goes on without it.
 */
export class ScreenWakeLock {
  private sentinel: WakeLockSentinelLike | undefined;
  private wanted = false;

  constructor(
    private readonly api: WakeLockApi | undefined = (globalThis as { navigator?: { wakeLock?: WakeLockApi } }).navigator?.wakeLock,
    private readonly page: VisibilityTarget | undefined = (globalThis as { document?: VisibilityTarget }).document,
  ) {}

  /** True when the lock is held. */
  async acquire(): Promise<boolean> {
    if (!this.api) return false;
    if (!this.wanted) {
      this.wanted = true;
      this.page?.addEventListener('visibilitychange', this.onVisibility);
    }
    return this.take();
  }

  async release(): Promise<void> {
    this.wanted = false;
    this.page?.removeEventListener('visibilitychange', this.onVisibility);
    const sentinel = this.sentinel;
    this.sentinel = undefined;
    try {
      await sentinel?.release();
    } catch {
      // Already released by the browser.
    }
  }

  private async take(): Promise<boolean> {
    if (!this.api || this.sentinel) return this.sentinel !== undefined;
    try {
      const sentinel = await this.api.request('screen');
      if (!this.wanted) {
        await sentinel.release();
        return false;
      }
      this.sentinel = sentinel;
      return true;
    } catch {
      return false;
    }
  }

  private readonly onVisibility = (): void => {
    if (!this.wanted || this.page?.visibilityState !== 'visible') return;
    // The browser released the old sentinel when the page was hidden.
    this.sentinel = undefined;
    void this.take();
  };
}
