/**
 * Minimal typed event emitter shared by the recorder and live dictation.
 * A handler that throws must not break the recording, so its error is rethrown on a later
 * tick, where it still reaches `window.onerror`, and the remaining handlers run.
 */
export class Emitter<Events extends object> {
  private readonly handlers: { [K in keyof Events]?: Set<(payload: Events[K]) => void> } = {};

  /** Subscribes to an event; returns the unsubscribe function. */
  on<K extends keyof Events>(event: K, handler: (payload: Events[K]) => void): () => void {
    const handlers = (this.handlers[event] ??= new Set());
    handlers.add(handler);
    return () => {
      handlers.delete(handler);
    };
  }

  protected emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    for (const handler of [...(this.handlers[event] ?? [])]) {
      try {
        handler(payload);
      } catch (error) {
        queueMicrotask(() => {
          throw error;
        });
      }
    }
  }
}
