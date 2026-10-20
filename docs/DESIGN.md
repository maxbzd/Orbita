# Orbita design

This file records the decisions and priorities of the visual language. Tokens live in `src/styles/tokens.css` and `themes.css`
(contrast of every text/background pair is checked by `src/styles/tokens.contrast.test.ts`); effects in `effects.css`.

## The formula

A personal night sky: one glowing object per screen, quiet dark glass around it and large human text. Time and people are orbits,
rings and constellations. Summaries are objects (a poster, a ticket, a passport). Work screens are calm and dense, without decoration.
An adult "personal cosmos", not a toy.

## Decisions

1. **Two themes on shared tokens:** "Night" (default; following the system is allowed) and "Dawn" (paper `#F6F3EC` + a pastel aura).
2. **A vocabulary of objects (not interchangeable):** Orb = capture / AI; Planet = a day; Flower = mood; Star = an insight; Constellation = connections; Ticket / Passport / Poster = summaries. No mascots, faces, gems or points.
3. **The orb is Canvas 2D**, with a CSS sphere as the fallback. It folds into a torus while "structuring". Recording starts before the beauty is drawn.
4. **Glass is scarce:** real `backdrop-filter` only on the navigation pill, sheets and the composer; cards are "light glass" without blur. Never a blur over an animated layer on a phone.
5. **Fonts (Latin + Cyrillic):** Cormorant Garamond (display ≥ 28 px, weight ≥ 500 on dark), Literata (text), Onest (interface), Unbounded (summary covers, the passport number), JetBrains Mono (numbers, statuses, mono caps). No external CDN.
6. **Colour is data.** The colour of a record type lives only in the type dot or badge; the colour of mood only in mood objects and the aura; text in chips is always `ink`. Only `ink` and `ink-2` appear over the aura.
7. **The AI proposes, a human confirms**, everywhere; honest emptiness and calibration ("needs 7 days of data").
8. **Walking mode:** 20 s without touches on the record screen → `#000`, the orb at 30 % brightness and 15 fps (on by default, can be turned off in Settings).
9. **Rewards:** no score, rarity, confetti or lost streaks.
10. **Greeting:** the name from the onboarding if given, otherwise only the time of day.

## Budgets

Touches to a recording: 1. Warm start to the first audio chunk ≤ 500 ms. Saving a recording never depends on the network.
First paint of Today ≤ 1.5 s.

## Navigation

Phone: a glass pill `Today · Stream · ● (record sphere) · Orbit · Me` with labels; in a recording the bar is hidden, on other screens a mini
recorder sits above it. Desktop ≥ 1280: sidebar 240 + centre ≤ 760 + right panel 340 + a docked recorder; 768-1279: sidebar 64;
< 768: the bottom pill. ⌘K / Ctrl+K opens the command palette.
