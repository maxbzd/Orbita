// Proves, in a real Chromium, what the app does when the browser refuses a write for lack of room:
// the refused change is announced at once, nothing saved earlier is damaged, and once there is room again the notice goes away.
// (Chromium cannot be given a small allowance from a script, so the refusal is simulated at the one place the app is exposed to
// it: the browser's `put` and `add` throw `QuotaExceededError`, exactly the error a full disk raises.)
//
//   npm run build && npm run preview -- --port 4173 --strictPort     (in another terminal)
//   BASE_URL=http://localhost:4173/ npm run e2e:quota
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { fallbackChromiumPath } from './chromium.ts';

const BASE = (process.env.BASE_URL ?? 'http://localhost:4173/').replace(/#.*$/, '');
const executablePath = fallbackChromiumPath();
const browser = await chromium.launch(executablePath ? { executablePath, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] });
const step = (text) => console.log(`• ${text}`);

/** Rows of one store, read straight from IndexedDB inside the page: what a reader of the browser's files would see. */
const count = (page, store) =>
  page.evaluate(
    (name) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('orbita');
        open.onsuccess = () => {
          const request = open.result.transaction(name).objectStore(name).count();
          request.onsuccess = () => {
            open.result.close();
            resolve(request.result);
          };
          request.onerror = () => reject(request.error);
        };
        open.onerror = () => reject(open.error);
      }),
    store,
  );

try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US' });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);

  await page.goto(`${BASE}#/onboarding`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByLabel('Name').fill('Tester');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Not yet, without AI' }).click();
  await page.getByRole('button', { name: 'Load demo data' }).click();
  await page.waitForTimeout(4000);
  const people = await count(page, 'people');
  const captures = await count(page, 'captures');
  assert.ok(people >= 5 && captures >= 5, 'the demo data is there');
  step(`${people} people and ${captures} notes saved`);

  // from here on the browser refuses every write
  await page.evaluate(() => {
    const refuse = (original) =>
      function (...args) {
        if (window.__storageFull) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        return original.apply(this, args);
      };
    IDBObjectStore.prototype.put = refuse(IDBObjectStore.prototype.put);
    IDBObjectStore.prototype.add = refuse(IDBObjectStore.prototype.add);
    window.__storageFull = true;
  });

  // a change that cannot be saved: a setting, changed from the settings screen
  await page.goto(`${BASE}#/settings?section=look`, { waitUntil: 'load' });
  const toggle = page.getByRole('switch').first();
  await toggle.waitFor();
  const wasOn = await toggle.getAttribute('aria-checked');
  await toggle.click();
  const alert = page.getByRole('alert').filter({ hasText: 'Storage is full' });
  await alert.waitFor();
  assert.ok((await alert.innerText()).includes('not saved'), 'the notice says the change was not saved');
  step('the person is told at once: "Storage is full"');
  assert.equal(await count(page, 'people'), people, 'no person was lost');
  assert.equal(await count(page, 'captures'), captures, 'no note was lost');
  step('nothing saved earlier was touched');

  // room again: the same change now works and the notice disappears by itself
  await page.evaluate(() => {
    window.__storageFull = false;
  });
  await page.getByRole('switch').first().click();
  await alert.waitFor({ state: 'detached' });
  assert.notEqual(await page.getByRole('switch').first().getAttribute('aria-checked'), wasOn, 'the change is saved once there is room');
  step('with room again the change is saved and the notice is gone');
  console.log('OK');
} catch (error) {
  console.error('FAILED:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
