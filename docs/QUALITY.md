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
| 4 | Speed | Lighthouse performance 0.67 → 0.76; the demo-data code (74 KB) and four extra stylesheets no longer block the first screen | build | Largest paint 4.8 s and blocking time 320 ms on the throttled profile; the orb chunk (128 KB) loads on the first screen |
| 5 | Accessibility | axe-core (WCAG 2.2 AA) on 18 screens: 0 serious or critical issues after fixes (was 74 name mismatches on 8 screens); keyboard reachable; no horizontal scroll at 320 px; animations stop with reduced motion | `e2e:audit` | Screen-reader pass by a person; 200 % text zoom; 3 controls on Today without a visible focus ring |
| 6 | Usability | Not measured | none | A test with people who have not seen the app |
| 7 | Offline | Reload with the network off opens the app | `e2e:audit` | Update-while-open scenario |
| 8 | Compatibility | Chromium only | none | Firefox, Safari / iOS |
| 9 | Languages | 7; five are machine drafts not reviewed by native speakers | `i18n:check` | Native review |
| 10 | Code | 2929 tests; coverage 87.8 % statements, 78.8 % branches | `test:coverage` | Add a floor |
| 11 | Supply chain | GitHub Actions pinned by commit hash and kept current by Dependabot; `npm audit` clean at high severity (10 low/moderate findings, all in build tooling that is not shipped) | `npm audit`, signatures | Reproducible build check |
| 12 | Documentation | Security model, architecture, cloud, language guide | review | — |
| 13 | Energy and memory | JS heap 15–80 MB with 5,000 rows in each of three tables; the stream is windowed (61 rows drawn for 3,000) | none | Long task of 316 ms when the stream opens with 5,000 records |
| 14 | User rights | Full export, delete all, open JSON formats | unit tests | A test that the export restores byte for byte |
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
