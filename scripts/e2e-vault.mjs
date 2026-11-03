// Proves, in a real Chromium, that "Protect this device" leaves nothing readable on disk.
//
//   npm run build && npm run preview -- --port 4173 --strictPort     (in another terminal)
//   BASE_URL=http://localhost:4173/ npm run e2e:vault
//
// It loads the demo data, reads every IndexedDB store the way anyone with the browser's files could, turns the protection
// on, reads them again, then checks the locked app, a wrong password, the right password and the recovery key. It also
// fails on any content-policy or Trusted Types violation, console error or uncaught exception along the way.
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { fallbackChromiumPath } from './chromium.ts';

const BASE = (process.env.BASE_URL ?? 'http://localhost:4173/').replace(/#.*$/, '');
const PASSWORD = 'correct-horse-battery-staple-42';

const executablePath = fallbackChromiumPath();
const browser = await chromium.launch(executablePath ? { executablePath, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US' });
const page = await context.newPage();
page.setDefaultTimeout(30_000);

const problems = [];
page.on('console', (message) => {
  if (message.type() === 'error') problems.push(`console: ${message.text().slice(0, 200)}`);
});
page.on('pageerror', (error) => problems.push(`uncaught: ${String(error).slice(0, 200)}`));
await page.addInitScript(() => {
  window.addEventListener('securitypolicyviolation', (event) => {
    (window.__violations ||= []).push(`${event.violatedDirective} ${(event.sample || '').slice(0, 80)}`);
  });
});

const step = (text) => console.log(`• ${text}`);

/** Every store of every database, as text: what a reader of the browser's files sees. Binary values are read as characters. */
const dump = () =>
  page.evaluate(async () => {
    const infos = await indexedDB.databases();
    const names = infos.map((info) => info.name);
    let text = '';
    for (const info of infos) {
      if (info.name === '__dbnames') continue;
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open(info.name);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      for (const store of Array.from(database.objectStoreNames)) {
        const rows = await new Promise((resolve) => {
          const request = database.transaction(store).objectStore(store).getAll();
          request.onsuccess = () => resolve(request.result);
        });
        text += JSON.stringify(rows, (_key, value) => (value instanceof Uint8Array ? Array.from(value, (c) => String.fromCharCode(c)).join('') : value)).slice(0, 3_000_000);
      }
      database.close();
    }
    return { names, text };
  });

try {
  await page.goto(`${BASE}#/onboarding`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByLabel('Name').fill('Tester');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Not yet, without AI' }).click();
  await page.getByRole('button', { name: 'Load demo data' }).click();
  await page.waitForTimeout(4000);

  // what the demo data holds, to look for afterwards
  const sample = await page.evaluate(async () => {
    const database = await new Promise((resolve) => {
      const request = indexedDB.open('orbita');
      request.onsuccess = () => resolve(request.result);
    });
    const all = (store) =>
      new Promise((resolve) => {
        const request = database.transaction(store).objectStore(store).getAll();
        request.onsuccess = () => resolve(request.result);
      });
    const captures = await all('captures');
    const people = await all('people');
    database.close();
    return [...captures.map((c) => (c.text || '').slice(0, 24)).filter((t) => t.length > 12), ...people.map((p) => p.name).filter((n) => n && n.length > 3)];
  });
  assert.ok(sample.length >= 5, `the demo data should give something to look for (got ${sample.length})`);
  const readable = (text) => sample.filter((s) => text.includes(s)).length;

  const before = await dump();
  assert.ok(readable(before.text) >= sample.length - 1, 'without protection the data is readable on disk (the test would prove nothing otherwise)');
  step(`before: ${readable(before.text)} of ${sample.length} notes and names are readable in IndexedDB`);

  await page.goto(`${BASE}#/settings?section=vault`, { waitUntil: 'load' });
  await page.getByRole('button', { name: 'Set it up' }).click();
  await page.getByLabel('Choose a password').fill(PASSWORD);
  await page.getByLabel('Repeat').fill(PASSWORD);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForSelector('[data-testid=recovery-key]');
  const recovery = (await page.locator('[data-testid=recovery-key]').innerText()).trim();
  assert.match(recovery, /^([0-9A-Z]{5}-){10}[0-9A-Z]{5}$/, 'a recovery key is shown');
  await page.getByRole('checkbox').check();
  await Promise.all([page.waitForNavigation({ waitUntil: 'load' }).catch(() => {}), page.getByRole('button', { name: 'Turn protection on' }).click()]);
  await page.waitForSelector('text=Orbita is locked');
  step('protection on: the app opens locked');

  const locked = await dump();
  assert.equal(readable(locked.text), 0, 'nothing readable in IndexedDB while locked');
  assert.ok(!locked.names.includes('orbita'), 'the plain database is gone');
  step(`locked: 0 of ${sample.length} readable, databases: ${JSON.stringify(locked.names)}`);

  await page.getByLabel('Password').fill('not-the-password');
  await page.getByRole('button', { name: 'Open' }).click();
  await page.waitForSelector('text=Wrong password.');
  step('a wrong password is refused');

  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Open' }).click();
  await page.waitForSelector('text=Orbita is locked', { state: 'detached', timeout: 60_000 });
  await page.waitForTimeout(1500);
  const open = await dump();
  assert.equal(readable(open.text), 0, 'nothing readable on disk even while unlocked');
  assert.ok(!open.names.includes('orbita'), 'no plain database while unlocked');
  step('unlocked with the password: still nothing readable on disk');

  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('text=Orbita is locked');
  await page.getByText('I forgot the password').click();
  await page.getByLabel('Recovery key').fill(recovery);
  await page.getByRole('button', { name: 'Open' }).click();
  await page.waitForSelector('text=Orbita is locked', { state: 'detached', timeout: 60_000 });
  step('the recovery key opens it too');

  const violations = await page.evaluate(() => window.__violations ?? []);
  assert.deepEqual(violations, [], 'no content-policy or Trusted Types violations');
  assert.deepEqual(problems, [], 'no console errors or uncaught exceptions');
  console.log('OK');
} catch (error) {
  console.error('FAILED:', error instanceof Error ? error.message : error);
  if (problems.length) console.error(problems.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
}
