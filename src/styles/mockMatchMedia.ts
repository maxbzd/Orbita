/**
 * Test helper: a controllable window.matchMedia (jsdom has none). Understands the queries the
 * design system uses: (min-width|max-width: Npx) and (prefers-*: value).
 */
export interface MatchMediaControl {
  setWidth(width: number): void;
  /** e.g. setFeature('prefers-reduced-motion', 'reduce') ; pass null to clear. */
  setFeature(name: string, value: string | null): void;
  restore(): void;
}

interface Entry {
  query: string;
  listeners: Set<(event: MediaQueryListEvent) => void>;
  last: boolean;
}

export function installMatchMedia(initial: { width?: number; features?: Record<string, string> } = {}): MatchMediaControl {
  let width = initial.width ?? 390;
  const features = new Map<string, string>(Object.entries(initial.features ?? {}));
  const entries = new Set<Entry>();
  const original = window.matchMedia;

  const evaluate = (query: string): boolean =>
    query
      .split(/\)\s*and\s*\(/i)
      .map((part) => part.replace(/^\(|\)$/g, '').trim())
      .every((cond) => {
        const [name = '', raw = ''] = cond.split(':').map((s) => s.trim());
        const px = parseFloat(raw);
        if (name === 'min-width') return width >= px;
        if (name === 'max-width') return width <= px;
        return features.get(name) === raw;
      });

  const notify = (): void => {
    for (const entry of entries) {
      const next = evaluate(entry.query);
      if (next === entry.last) continue;
      entry.last = next;
      for (const listener of entry.listeners) listener({ matches: next, media: entry.query } as MediaQueryListEvent);
    }
  };

  window.matchMedia = ((query: string): MediaQueryList => {
    const entry: Entry = { query, listeners: new Set(), last: evaluate(query) };
    entries.add(entry);
    return {
      get matches() {
        return evaluate(query);
      },
      media: query,
      onchange: null,
      addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => entry.listeners.add(listener),
      removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) =>
        entry.listeners.delete(listener),
      addListener: (listener: (event: MediaQueryListEvent) => void) => entry.listeners.add(listener),
      removeListener: (listener: (event: MediaQueryListEvent) => void) => entry.listeners.delete(listener),
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;

  return {
    setWidth(next) {
      width = next;
      notify();
    },
    setFeature(name, value) {
      if (value === null) features.delete(name);
      else features.set(name, value);
      notify();
    },
    restore() {
      if (original) window.matchMedia = original;
      else Reflect.deleteProperty(window, 'matchMedia');
      entries.clear();
    },
  };
}
