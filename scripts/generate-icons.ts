/**
 * Renders the temporary app icon (a sphere on an orbit) to public/icons.
 * Run with `npm run icons`; replace `iconSvg` (or the generated files) when the real identity lands.
 * Needs Chromium: either the one Playwright expects or a preinstalled one (see e2e/chromium.ts).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { fallbackChromiumPath } from './chromium.ts';

const OUT_DIR = new URL('../public/icons/', import.meta.url);

/**
 * `bleed` icons fill the whole canvas (maskable and Apple icons are cropped by the OS);
 * the rest get rounded corners. All artwork stays inside the maskable safe zone (r ≤ 205 of 512).
 */
function iconSvg({ bleed }: { bleed: boolean }): string {
  const corner = bleed ? 0 : 112;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="sky" cx="50%" cy="42%" r="75%">
      <stop offset="0" stop-color="#1d1e45"/>
      <stop offset="0.55" stop-color="#0c0d20"/>
      <stop offset="1" stop-color="#07080f"/>
    </radialGradient>
    <radialGradient id="sphere" cx="38%" cy="32%" r="75%">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="0.3" stop-color="#cfc9ff"/>
      <stop offset="0.68" stop-color="#6f63ff"/>
      <stop offset="1" stop-color="#2b2478"/>
    </radialGradient>
    <linearGradient id="ring" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#8b7bff"/>
      <stop offset="1" stop-color="#4fd1ff"/>
    </linearGradient>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="22"/>
    </filter>
  </defs>
  <rect width="512" height="512" rx="${corner}" fill="url(#sky)"/>
  <g fill="#ffffff">
    <circle cx="92" cy="104" r="3" opacity="0.7"/>
    <circle cx="428" cy="84" r="2.5" opacity="0.55"/>
    <circle cx="438" cy="402" r="3" opacity="0.6"/>
    <circle cx="74" cy="360" r="2.5" opacity="0.5"/>
    <circle cx="352" cy="438" r="2" opacity="0.45"/>
  </g>
  <circle cx="256" cy="256" r="104" fill="#6f63ff" opacity="0.55" filter="url(#glow)"/>
  <g transform="rotate(-24 256 256)" fill="none" stroke="url(#ring)" stroke-width="7" stroke-linecap="round">
    <ellipse cx="256" cy="256" rx="178" ry="70" opacity="0.4"/>
    <circle cx="256" cy="256" r="74" fill="url(#sphere)" stroke="none"/>
    <path d="M434 256 A178 70 0 0 1 78 256"/>
    <circle cx="387" cy="209" r="15" fill="#4fd1ff" stroke="none"/>
  </g>
</svg>
`;
}

const FILES = [
  { name: 'icon-192.png', size: 192, bleed: false },
  { name: 'icon-512.png', size: 512, bleed: false },
  { name: 'icon-maskable-512.png', size: 512, bleed: true },
  { name: 'apple-touch-icon.png', size: 180, bleed: true },
] as const;

await mkdir(OUT_DIR, { recursive: true });
await writeFile(new URL('icon.svg', OUT_DIR), iconSvg({ bleed: false }));

const browser = await chromium.launch({ executablePath: fallbackChromiumPath() });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const { name, size, bleed } of FILES) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${iconSvg({ bleed })}`,
    );
    const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    await writeFile(new URL(name, OUT_DIR), png);
    console.log(`public/icons/${name} (${size}x${size}${bleed ? ', full-bleed' : ''})`);
  }
} finally {
  await browser.close();
}
