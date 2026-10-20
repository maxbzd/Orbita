// Takes the README screenshots in English and Russian from the demo data.
//
//   npm run dev -- --port 5199        (in another terminal)
//   npm run screenshots               (default URL http://localhost:5199)
//
// Output: docs/img/<screen>.jpg and docs/img/<screen>-ru.jpg. Needs a Chromium (see scripts/chromium.ts).
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { fallbackChromiumPath } from './chromium.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'docs', 'img');
mkdirSync(out, { recursive: true });
const BASE = process.env.BASE_URL ?? 'http://localhost:5199';

const SCREENS = [
  ['today', '/today'],
  ['stream', '/stream'],
  ['orbit', '/orbit?tab=time&view=week'],
  ['commitments', '/items/commitment'],
];

const executablePath = fallbackChromiumPath();
const browser = await chromium.launch(executablePath ? { executablePath, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] });

for (const lang of ['en', 'ru']) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    colorScheme: 'dark',
    locale: lang === 'ru' ? 'ru-RU' : 'en-US',
    timezoneId: 'Europe/Berlin',
  });
  await context.addInitScript((value) => {
    try {
      localStorage.setItem('orbita.locale', value);
    } catch {}
  }, lang);
  const page = await context.newPage();
  page.on('pageerror', (error) => console.log('pageerror', error.message));

  await page.goto(`${BASE}/#/onboarding`);
  await page.waitForFunction(() => window.__orbit);
  await page.evaluate(async () => {
    await window.__orbit.seedDemo();
    await window.__orbit.updateSettings({ onboarding: { done: true } });
  });
  for (const [name, path] of SCREENS) {
    await page.goto(`${BASE}/#${path}`);
    await page.reload();
    await page.waitForTimeout(2200);
    await page.screenshot({ path: join(out, `${name}${lang === 'ru' ? '-ru' : ''}.jpg`), type: 'jpeg', quality: 86 });
    console.log('shot', lang, name);
  }
  await context.close();
}
await browser.close();
