import type { ID } from '../domain/types';

/** The slice of `navigator.locks` used here. */
export interface LockManagerLike {
  request(name: string, options: { ifAvailable: boolean }, callback: (lock: object | null) => unknown): Promise<unknown>;
}

const noop = (): void => {};
const lockName = (captureId: ID): string => `orbita-recording:${captureId}`;

/**
 * "This recording is being made right now". The chunks of a live recording look exactly like
 * the leftovers of a crashed one, and recovering a live recording would glue and delete the
 * chunks under the recorder. A Web Lock tells them apart: the browser releases it the moment
 * the tab holding it dies, in any tab, so a crash never leaves a stale mark behind.
 */
export class RecordingLocks {
  private readonly active = new Set<ID>();

  constructor(private readonly manager: LockManagerLike | undefined = (globalThis as { navigator?: { locks?: LockManagerLike } }).navigator?.locks) {}

  /** Marks a recording as live until the returned function is called (or the tab goes away). */
  async acquire(captureId: ID): Promise<() => void> {
    let release = noop;
    if (this.manager) {
      release = await new Promise<() => void>((resolve) => {
        this.manager!.request(lockName(captureId), { ifAvailable: true }, (lock) => {
          if (!lock) {
            resolve(noop);
            return undefined;
          }
          // The lock lives as long as this promise is pending.
          return new Promise<void>((done) => resolve(() => done()));
        }).catch(() => resolve(noop));
      });
    }
    this.active.add(captureId);
    return () => {
      this.active.delete(captureId);
      release();
    };
  }

  /** `true`: being recorded now (here or in another tab); `false`: nobody; `undefined`: cannot tell. */
  async isHeld(captureId: ID): Promise<boolean | undefined> {
    if (this.active.has(captureId)) return true;
    if (!this.manager) return undefined;
    try {
      return (await this.manager.request(lockName(captureId), { ifAvailable: true }, (lock) => lock === null)) as boolean;
    } catch {
      return undefined;
    }
  }
}

export const recordingLocks = new RecordingLocks();
