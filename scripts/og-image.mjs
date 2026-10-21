// Renders the 1200x630 preview image shown when a link to the app is shared (public/og.png).
//
//   node scripts/og-image.mjs [--name Orbita] [--tagline "..."] [--sub "..."] [--icon public/icons/icon.svg]
//                              [--shots docs/img/today.jpg,docs/img/orbit.jpg] [--out public/og.png]
//
// Needs a Chromium (see scripts/chromium.ts). The fonts come from node_modules/@fontsource-variable.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { fallbackChromiumPath } from './chromium.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, i, all) => (arg.startsWith('--') ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs), []));
const name = args.name ?? 'Orbita';
const tagline = args.tagline ?? 'Think out loud. Keep what matters.';
const sub = args.sub ?? 'A private, local-first journal that turns voice notes into decisions, commitments and ideas.';
const icon = resolve(root, args.icon ?? 'public/icons/icon.svg');
const shots = (args.shots ?? 'docs/img/today.jpg,docs/img/orbit.jpg').split(',').map((file) => resolve(root, file));
const out = resolve(root, args.out ?? 'public/og.png');
const fontDir = join(root, 'node_modules', '@fontsource-variable');
const font = (family, file) => pathToFileURL(join(fontDir, family, 'files', file)).href;
const data = (file) => `data:${file.endsWith('.svg') ? 'image/svg+xml' : 'image/jpeg'};base64,${readFileSync(file).toString('base64')}`;

const html = `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:Onest;src:url(${font('onest', 'onest-latin-wght-normal.woff2')});font-weight:100 900}
@font-face{font-family:Cormorant;src:url(${font('cormorant-garamond', 'cormorant-garamond-latin-wght-normal.woff2')});font-weight:300 700}
*{box-sizing:border-box;margin:0}
body{width:1200px;height:630px;overflow:hidden;position:relative;font-family:Onest,sans-serif;color:#f2f1ff;
 background:radial-gradient(900px 600px at 78% 30%,#25266a 0%,#0e0f26 55%,#07080f 100%)}
.stars{position:absolute;inset:0;background-image:radial-gradient(1.4px 1.4px at 12% 20%,#fff9,transparent),radial-gradient(1px 1px at 33% 78%,#fff8,transparent),radial-gradient(1.2px 1.2px at 52% 12%,#fff8,transparent),radial-gradient(1px 1px at 61% 88%,#fff7,transparent),radial-gradient(1.4px 1.4px at 90% 70%,#fff8,transparent),radial-gradient(1px 1px at 5% 60%,#fff7,transparent)}
.left{position:absolute;left:84px;top:0;bottom:0;width:560px;display:flex;flex-direction:column;justify-content:center}
.brand{display:flex;align-items:center;gap:20px;margin-bottom:36px}
.brand img{width:84px;height:84px;border-radius:22px}
.brand span{font-size:40px;font-weight:600;letter-spacing:.01em}
h1{font-family:Cormorant,serif;font-weight:600;font-size:76px;line-height:1.02;letter-spacing:-.01em}
p{margin-top:26px;font-size:26px;line-height:1.4;color:#b9b7dd;max-width:520px}
.phone{position:absolute;width:268px;height:580px;border-radius:38px;overflow:hidden;border:2px solid #ffffff2a;box-shadow:0 30px 80px #000a,0 0 80px #6f63ff40}
.phone img{width:100%;height:100%;object-fit:cover;object-position:top}
.p1{left:672px;top:70px;transform:rotate(-5deg)}
.p2{left:906px;top:120px;transform:rotate(4deg)}
</style><div class="stars"></div>
<div class="left"><div class="brand"><img src="${data(icon)}"><span>${name}</span></div><h1>${tagline}</h1><p>${sub}</p></div>
<div class="phone p1"><img src="${data(shots[0])}"></div>
${shots[1] ? `<div class="phone p2"><img src="${data(shots[1])}"></div>` : ''}`;

const executablePath = fallbackChromiumPath();
const browser = await chromium.launch(executablePath ? { executablePath, args: ['--no-sandbox', '--allow-file-access-from-files'] } : { args: ['--no-sandbox', '--allow-file-access-from-files'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
const file = join(root, '.og-image.tmp.html');
writeFileSync(file, html);
await page.goto(pathToFileURL(file).href);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: out, type: 'png' });
await browser.close();
import('node:fs').then(({ rmSync }) => rmSync(file));
console.log('wrote', out);
