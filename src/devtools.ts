// Dev helpers (screenshots, manual testing) exposed on `window.__orbit`. Loaded only in dev or with VITE_E2E=1.
import { db, updateSettings } from './db';
import { removeDemo, seedDemo } from './db/seed';

declare global {
  interface Window {
    __orbit?: { db: typeof db; seedDemo: typeof seedDemo; removeDemo: typeof removeDemo; updateSettings: typeof updateSettings };
  }
}

window.__orbit = { db, seedDemo, removeDemo, updateSettings };
