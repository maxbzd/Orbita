/** Small per-device conveniences of the recording screen. Every access is guarded: storage may be blocked. */

const KEYS = {
  draft: 'orbit.capture.draft',
  keepOpenHint: 'orbit.capture.keepOpenHint',
} as const;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Private window or full storage: the convenience is simply off.
  }
}

/** The unsent text of the text mode, so a closed tab does not eat a half-written thought. */
export const draftStore = {
  load: (): string => read(KEYS.draft) ?? '',
  save: (text: string): void => write(KEYS.draft, text.trim() === '' ? null : text),
  clear: (): void => write(KEYS.draft, null),
};

/** «Не закрывай приложение во время записи» is shown once. */
export const keepOpenHint = {
  seen: (): boolean => read(KEYS.keepOpenHint) === '1',
  markSeen: (): void => write(KEYS.keepOpenHint, '1'),
};
