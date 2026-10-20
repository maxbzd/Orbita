import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { Blob as NodeBlob } from 'node:buffer';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';
import { registerDictionary, setLocale } from './i18n';
import type { Dictionary } from './i18n';
import ru from './i18n/locales/ru.json';

// The suite asserts the Russian interface (the original language of the app); English is covered by tests that call `setLocale('en')`.
registerDictionary('ru', ru as Dictionary);
setLocale('ru');

// jsdom's Blob has no `arrayBuffer()` and does not survive Node's `structuredClone`, which
// fake-indexeddb uses to store values. Node's own Blob does both, like a real browser.
globalThis.Blob = NodeBlob as typeof Blob;

// findBy*/waitFor give up after 1 s by default: too tight while the whole suite shares the CPU.
configure({ asyncUtilTimeout: 5000 });

// Vitest runs without globals, so Testing Library cannot register its own cleanup.
afterEach(cleanup);

// Newer Node versions validate `RequestInit.signal` against their own AbortSignal and reject
// jsdom's, which breaks react-router data routers (they build a Request per navigation).
// Nothing in the tests aborts navigations, so the signal is dropped.
const NativeRequest = globalThis.Request;
globalThis.Request = class extends NativeRequest {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    if (init && 'signal' in init) {
      const { signal: _dropped, ...rest } = init;
      super(input, rest);
    } else {
      super(input, init);
    }
  }
} as typeof Request;

// The suite never talks to a real Supabase project: requests to *.supabase.co fail fast instead of waiting on DNS.
// Tests that need a response stub `fetch` themselves.
const realFetch = globalThis.fetch;
if (realFetch) {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (/^https?:\/\/[^/]*\.supabase\.co\b/.test(url)) return Promise.reject(new TypeError('network is disabled in tests'));
    return realFetch(input, init);
  }) as typeof fetch;
}
