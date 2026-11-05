# Quality: what is measured, what is promised, what is missing

The goal is to be a reference in every area that matters for a personal journal that keeps private data. "Reference" here means one thing:
**a claim is only made when a test or a measurement that anyone can repeat backs it.** This page lists each area, the last measurement,
what already guards it in CI, and what is still open. It is rewritten when a number changes, not when it is hoped to.

Measured on 3 November 2026, Chromium 1243 headless, mobile profile (Lighthouse: slow 4G, 4× CPU slowdown), built app served by `vite preview`.
Only Chromium was available, so **Firefox and Safari are not measured** (see Compatibility).

| # | Area | Last measurement | Guarded in CI by | Open |
|---|---|---|---|---|
| 1 | Security | Device vault, end-to-end cloud, post-quantum pairing, Trusted Types; browser test finds 0 of 62 notes and names readable on disk with the vault on | `e2e:vault`, unit tests, SQL tests | Independent audit not done |
| 2 | Privacy | 0 requests to other origins across all screens, no trackers, no third-party fonts | `e2e:audit` | Behaviour with an AI key or cloud account is by design (their servers) |
| 3 | Data safety | Encrypted backups, automatic encrypted copies into a folder (Chrome/Edge), iOS 7-day warning, server refuses out-of-date edits; **a write refused for lack of room is announced at once** ("Storage is full: the last change was not saved"), an early warning from 90 % of the allowance, a backup in one tap, and the sound of old finished records can be given up (asked first; the texts stay) | unit tests, SQL tests, `e2e:quota` | No crash-in-the-middle-of-a-write test; the real browser limit could not be reached in the test environment, so the refusal is simulated with the exact error a full disk raises |
| 4 | Speed | Lighthouse performance 0.67 → 0.74–0.77 (three runs); blocking time 500 → 260–340 ms; **JavaScript fetched at launch 330 → 276 KB gzip (−16 %)**: the AI layer (providers, prompts, the pipeline; the largest part of the code) is now loaded when a record is processed or a day is closed, not at launch; routes no longer pull each screen's logic into the first download; the demo data and four extra stylesheets no longer block the first screen; the two fonts of the first screen are announced early | build | Largest paint 4.9 s on the throttled profile (the first screen is drawn after the route chunk, the data and the fonts arrive in sequence on a slow-4G profile); zod (about 60 KB) is needed at launch by the database layer |
| 5 | Accessibility | axe-core (WCAG 2.2 AA) on 18 screens: 0 serious or critical issues after fixes (was 74 name mismatches on 8 screens); keyboard reachable, and every control shows a focus ring (the round controls in the day orbit draw their own); no horizontal scroll at 320 px (the width that browser zoom of 400 % gives) with the page's text size doubled, checked on every screen; animations stop with reduced motion | `e2e:audit` | Screen-reader pass by a person |
| 6 | Usability | Not measured | none | A test with people who have not seen the app |
| 7 | Offline and updates | Reload with the network off opens the app; **a new version is fetched in the background and announced ("A new version is ready — Update"), never swapped in under someone's hands: a half-written name survives, and the app reloads into the new version only when the person says so** (before this the new version waited for the app to be closed, which on an installed phone can be weeks); the app asks for new versions hourly and when it comes to the front | `e2e:audit`, `e2e:update` (builds two versions and updates one to the other in a real browser) | — |
| 8 | Compatibility | Run in Chromium only. **Every JavaScript file of the build parses as ES2022**, so nothing newer than Chrome 94, Firefox 93 and Safari 15.4 can ship by accident; features that only some browsers have (passkeys with PRF, a backup folder, the Web Speech API, Trusted Types, `navigator.locks`) are detected and the app works without them | `check:syntax` | Firefox, Safari and iOS have not been run: that needs those browsers |
| 9 | Languages | 7; five are machine drafts not reviewed by native speakers | `i18n:check` | Native review |
| 10 | Code | 3004 tests; coverage 87.3 % statements, 79.9 % branches, 83.7 % functions, 89.5 % lines (test files are not counted: an earlier figure of 87.8 % counted them); the lock screen, vault gate and the protection section of Settings, the sync merge, the backup folder and the device vault's second window, erase and auto-lock now have tests | `test:coverage` with a floor (87 / 79 / 83 / 89) | The largest gaps are the people sphere, the data and vault sections of Settings, and the entry screen |
| 11 | Supply chain | GitHub Actions pinned by commit hash and kept current by Dependabot; `npm audit` clean at high severity (10 low/moderate findings, all in build tooling that is not shipped); **the build is reproducible: two builds of the same source in different folders give byte-identical files (98), with a fingerprint printed** | `npm audit`, signatures, `check:reproducible` | Comparing the fingerprint with the published site (needs the hosting to publish it) |
| 12 | Documentation | Security model (who is protected against what, and what is not; `docs/SECURITY_MODEL.md`), architecture, cloud, language guide, each also in Russian | review | — |
| 13 | Energy and memory | **Measured with 3,000 notes, 3,000 items and 3,000 people**: the longest single task on the six heavy screens is 0.5 s (people), 0.2 s (stream), under 0.1 s on the others; JS heap 20–100 MB; the stream is windowed (about 5,000 page elements for 3,000 notes). The same run on Aster found a 29-second freeze, which is why this is now a test | `e2e:scale` (fails when a screen holds the page for over 2.5 s or the heap passes 500 MB; 2,000 rows by default, `SIZE=3000` for more) | The people list draws every row (36k page elements at 3,000); a windowed list would cut that |
| 14 | User rights | Full export, delete all, open JSON formats; **export → wipe → import → export gives the same data, field for field, recordings included; importing twice changes nothing; an import that fails halfway rolls back and leaves what was there; a damaged file is refused before anything is touched** | unit tests | — |
| 15 | Open project | Contributing guide, security policy, code of conduct | review | — |

## How to repeat the measurements

```bash
npm run build && npm run preview -- --port 4173 --strictPort &
BASE_URL=http://localhost:4173/ npm run e2e:vault      # nothing readable on disk, locked or unlocked
BASE_URL=http://localhost:4173/ npm run e2e:audit      # no foreign requests, no serious axe violation, opens offline
npx lighthouse http://localhost:4173/ --preset=perf --form-factor=mobile
npm run test:coverage
./scripts/test-sql.sh                                  # server rules, needs a PostgreSQL
```

Lighthouse varies by ±0.03 between runs on the same machine; compare medians of three, not single runs.

## What changed because of the first measurement

- The demo-data module is loaded only when someone asks for the example data (it was in the first screen's download).
- One stylesheet instead of five render-blocking ones.
- Controls that showed one text and were named another now carry the visible text in their name (day strip, collection cards, item rows, the "+N" overflow satellite).
- `robots.txt` added; GitHub Actions pinned by hash with Dependabot.
