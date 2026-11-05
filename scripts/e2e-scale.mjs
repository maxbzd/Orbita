// A big journal must stay usable. In a real Chromium this loads the demo data, multiplies it to SIZE notes, tasks and people, then
// opens the heavy screens one by one and fails when one of them holds the page for too long or the memory grows too far.
//
//   npm run build && npm run preview -- --port 4173 --strictPort     (in another terminal)
//   BASE_URL=http://localhost:4173/ npm run e2e:scale
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { fallbackChromiumPath } from './chromium.ts';

const BASE = (process.env.BASE_URL ?? 'http://localhost:4173/').replace(/#.*$/, '');
const SIZE = Number(process.env.SIZE ?? 2000);
// generous: a CI machine is slower than a laptop, and a long task is not yet a freeze
const BUDGET = { longestTaskMs: Number(process.env.LONGEST_TASK_MS ?? 2500), heapMB: Number(process.env.HEAP_MB ?? 500) };
const ROUTES = ['/today', '/stream', '/people', '/items/task', '/orbit', '/ask'];

const executablePath = fallbackChromiumPath();
const browser = await chromium.launch(executablePath ? { executablePath, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] });
const results = [];
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US' });
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');

  await page.goto(`${BASE}#/onboarding`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByLabel('Name').fill('Tester');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Not yet, without AI' }).click();
  await page.getByRole('button', { name: 'Load demo data' }).click();
  await page.waitForTimeout(4000);

  const sizes = await page.evaluate(async ({ SIZE }) => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('orbita'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const out = {};
    for (const store of ['captures', 'items', 'people']) {
      const rows = await new Promise((res) => { const r = db.transaction(store).objectStore(store).getAll(); r.onsuccess = () => res(r.result); });
      const keyPath = db.transaction(store).objectStore(store).keyPath;
      if (!rows.length || typeof keyPath !== 'string') { out[store] = rows.length; continue; }
      const add = [];
      for (let i = 0; rows.length + add.length < SIZE; i++) {
        const copy = structuredClone(rows[i % rows.length]);
        copy[keyPath] = crypto.randomUUID();
        if (copy.name) copy.name = `${copy.name} ${i}`;
        add.push(copy);
      }
      await new Promise((res, rej) => { const tx = db.transaction(store, 'readwrite'); add.forEach((r) => tx.objectStore(store).put(r)); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
      out[store] = rows.length + add.length;
    }
    db.close();
    return out;
  }, { SIZE });
  console.log(`• ${sizes.captures} notes, ${sizes.items} items, ${sizes.people} people`);
  assert.ok(sizes.captures >= SIZE && sizes.items >= SIZE && sizes.people >= SIZE, 'the data was multiplied');

  for (const route of ROUTES) {
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(600);
    const m = await page.evaluate(async (to) => {
      const longs = [];
      const po = new PerformanceObserver((l) => l.getEntries().forEach((e) => longs.push(e.duration)));
      po.observe({ type: 'longtask' });
      const t0 = performance.now();
      let last = t0;
      const mo = new MutationObserver(() => { last = performance.now(); });
      mo.observe(document.body, { subtree: true, childList: true, attributes: true });
      location.hash = `#${to}`;
      // settled: nothing has changed on the page for 400 ms
      await new Promise((res) => { const tick = () => (performance.now() - last > 400 && performance.now() - t0 > 500 ? res() : setTimeout(tick, 50)); tick(); });
      mo.disconnect(); po.disconnect();
      return { longestTask: Math.round(Math.max(0, ...longs)), nodes: document.querySelectorAll('*').length };
    }, route);
    const heap = (await cdp.send('Performance.getMetrics')).metrics.find((x) => x.name === 'JSHeapUsedSize').value;
    results.push({ route, ...m, heapMB: Math.round(heap / 1048576) });
  }
} finally {
  await browser.close();
}

console.table(results);
const bad = results.filter((r) => r.longestTask > BUDGET.longestTaskMs || r.heapMB > BUDGET.heapMB);
assert.equal(bad.length, 0, `over budget (${BUDGET.longestTaskMs} ms for one task, ${BUDGET.heapMB} MB of memory): ${bad.map((r) => `${r.route} ${r.longestTask} ms ${r.heapMB} MB`).join('; ')}`);
console.log(`OK — with ${SIZE} notes, items and people no screen holds the page longer than ${BUDGET.longestTaskMs} ms`);
