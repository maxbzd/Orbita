/**
 * What the user's endpoint turned out to support, learned from 400 answers ("this model does not accept
 * `tool_choice`", "use `max_completion_tokens`"). Remembered for the page's lifetime so that only the
 * first request pays for the lesson; keyed by endpoint and model, never by secrets.
 */

const learned = new Map<string, unknown>();

export function recall<T>(key: string): T | undefined {
  return learned.get(key) as T | undefined;
}

export function remember(key: string, value: unknown): void {
  learned.set(key, value);
}

/** For tests: every test starts from a provider that knows nothing. */
export function forgetLearnedCapabilities(): void {
  learned.clear();
}
