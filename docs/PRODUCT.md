# Orbita: a personal system for making sense of life and work

One user, a phone as the main device, a desktop as a second shell of the same app (a PWA). English and Russian.

> This is the product description. Technical side: [ARCHITECTURE.md](ARCHITECTURE.md), [DATA_MODEL.md](DATA_MODEL.md). Visual language: [DESIGN.md](DESIGN.md).

## 1. Who it is for and why

For people who think out loud: voice notes on a walk, dictation, long conversations with an AI. Normally all of that is lost
or ends up as a dump nobody reads again.

**The job of the app:** take what you say and write, turn it into structure, and give the value back. The loop:

1. **Capture.** One tap, no choosing a format, no "where do I put this".
2. **Process.** The AI extracts decisions, commitments, ideas, predictions, mood, people and patterns; you confirm in ten seconds.
3. **Review.** Day, week, month, year: what happened, what repeats, what is overdue, where your predictions were off.
4. **Act.** Reviews produce concrete next steps and questions to yourself.

The data is very personal, so the app is **local-first**: everything is stored on the device, and the only thing that leaves it is what you send to
your own AI provider. What you accumulate becomes **context for any AI**, exported in one tap.

## 2. Principles

1. **Capture speed beats beauty.** From the home-screen icon to a running recording: one tap. The "wow" lives around capture and never gets in its way.
2. **Nothing is lost.** The raw recording (audio and text) is always kept, even when the AI is not configured or fails. Processing can be repeated.
3. **The AI proposes, you decide.** Every extracted object arrives as "proposed" and is accepted, edited or dismissed. Optional auto-accept for high confidence.
4. **Everything traces to its source.** Any decision, idea or pattern links to a quote in the original note.
5. **Works without AI.** Without a key it is a good voice diary with manual tagging, a rule-based engine and a copy-paste mode (copy the prompt, paste into any AI chat, paste the answer back).
6. **Honest with your data.** Export everything in an open format, encrypted backup, deletion in one step, no telemetry.
7. **Beautiful, not childish.** A night sky, glass and orbits: an adult "personal cosmos", no gamification for its own sake.

## 3. Entities

Full types are in [DATA_MODEL.md](DATA_MODEL.md). In short:

| Entity | What it is | Key fields |
|---|---|---|
| **Capture** | Raw input: voice / text / imported AI chat / quick check-in | audio, transcript, source, context (walk/home/...), processing status |
| **Decision** | What you decided and why | question, choice, alternatives, reasons, expected outcome, review date, outcome |
| **Commitment** | What was promised to whom | direction (I owe / owed to me), counterparty, due date, status |
| **Idea** | A spark | stage (spark → exploring → doing → parked/dropped), project, related ideas |
| **Prediction** | A forecast with a probability | claim, probability %, due date, outcome → calibration (Brier) |
| **Task** | A concrete next step | due date, project, source |
| **Question** | An open question to yourself | stays open until answered |
| **Lesson** | A takeaway worth remembering | text, topic |
| **Fact** | Durable knowledge about the world, work or yourself ("we have 14 customers") | value, validity |
| **Check-in** | How you feel at a moment | valence (−1…1), energy (0…1), focus, stress, tags; entered by hand or suggested from a note |
| **Person** | A colleague, client, friend, family member... | role, aliases, notes, last contact, relationship mood |
| **Project** | An endeavour or direction | kind, status, keywords |
| **Pattern** | Something that repeats in your life | description, evidence (notes), confidence, status (candidate/confirmed/rejected), what to do |
| **Review** | A generated summary of a period | period, sections, reflection questions, your answers |

## 4. Screens (phone)

Bottom navigation (a glass pill): **Today · Stream · ● Record · Orbit · Me**. The central sphere: tap = record, long press = a fan of actions
(Voice · Text · Check-in · Import an AI chat · Quick thought).

1. **Onboarding** (first run): name and what you do → connect an AI (or "not now") → why the microphone → a first 20-second recording as a trial run. Optionally "Load demo data".
2. **Today.** The background aura reacts to the state of the day. Greeting, the day's "orbit" (a time ring and the number of notes), cards: what is on fire today (commitments, predictions to close, decisions to revisit), the latest AI insight, a quick check-in, and "Close the day" in the evening.
3. **Record** (full screen). A large glowing sphere as the button, reacting to loudness; states: idle → listening → paused → processing. Live "karaoke" transcript when browser dictation is available. Recording lock (hands-free on a walk), timer, context chips (walk/home/transit/project), a switch to text. Saving is never blocked by the network.
4. **Review of extraction.** After processing: "The AI found N objects", grouped by type, swipe or buttons: accept · edit · dismiss; "accept all"; new people and projects offered for creation or merging with existing ones; duplicates flagged.
5. **Stream.** A chronology of notes with chips of what was extracted; filters by type/person/project/period; full-text search with prefixes; "unprocessed" on top.
6. **Capture details.** Audio player with a waveform, the transcript with extracted quotes highlighted, the note's objects, re-run processing, edit the text.
7. **Orbit** (segments *Time · People · Patterns*). Time as space: Day / Week / Month / Year. Day is a disk of 24 hours with arcs of notes and mood; week and month are an orbit of days; year is a sky of stars. Layers: mood, notes, commitments, patterns. Tap a day for details.
8. **Objects** (inside "Me" and via chips): lists of **Commitments / Decisions / Predictions / Ideas / Tasks / Questions / Lessons / Facts** with one shared interface (filter, search, statuses) and specifics:
   - Commitments: "I owe / owed to me", by person, overdue.
   - Decisions: a journal with a review window ("how did it turn out?").
   - Predictions: a probability slider, resolving an outcome, **calibration** (the "said 70%, came true 55%" chart), Brier score.
   - Ideas: a constellation/board, merging duplicates, turning into a task or project.
9. **People.** A constellation of people: size = frequency, brightness = freshness of contact. A person's card: a timeline of mentions, open commitments both ways, facts, relationship mood, and "prepare for a conversation" (a short digest for an AI or for yourself).
10. **Patterns.** Cards with evidence (quotes and dates), confidence, "yes, that's me / no" buttons, "what to do about it". Recomputed on request and weekly.
11. **Reviews.** Weekly, monthly and yearly as "stories" (full-screen cards, swipe): totals, wins, overdue, patterns, calibration, 2-3 reflection questions. The yearly "Passport" is a card-object with statistics (notes, words, hours of voice, people, decisions, forecast accuracy).
12. **Ask.** A chat with your own life (text/voice): answers with links to notes and objects; quick questions ("what did I promise this week?", "what am I avoiding?", "what did I decide about X and why?").
13. **AI context.** A builder: profile ("who I am", goals, values, how to talk to me) + sections (projects, open commitments, decisions, people, patterns, last N days), time window, filters by people/projects, **privacy level** (full names / initials / "Person A"), size estimate in tokens, preview, Copy, download .md/.json, presets ("morning review", "before a call with X", "strategy session").
14. **Me.** Profile, streak and weekly streak (information, not pressure), "Collections" of objects, Memory ("what the AI knows"), the yearly Passport. No points, ratings, rarity or lost streaks.
15. **Settings.** AI (provider, key, models, connection test), speech recognition, language and glossary (your own terms, which improves transcript correction), look (auto/dark/light), password lock, export/import/encrypted backup, demo data, delete everything, token usage, cloud.

## 5. Desktop

The same code base with an adaptive shell: a navigation sidebar on the left, content in the centre, a context panel on the right (details of the selected
object). A global command palette **Ctrl/⌘K** (search + actions), a record hotkey (Space on the record page, **Ctrl+Shift+R** anywhere in the app).
A wide Orbit dashboard with several layers at once.

## 6. How the AI works

1. **Speech recognition.** Recording is always saved (MediaRecorder); text comes from (a) live browser dictation, (b) post-recognition through an
   OpenAI-compatible `/audio/transcriptions` (OpenAI, Groq...), (c) typing. A glossary pass follows.
2. **Extraction.** One structured call (tool use / JSON schema) returns a title, summary, mood (with confidence), objects of every type with
   **evidence quotes**, mentions of people and projects, tags, and clarifying questions. zod validation plus one auto-repair attempt.
3. **Entity resolution.** Names are matched with existing people/projects (aliases, fuzzy comparison); ambiguous ones wait for confirmation; duplicates are found by trigram similarity plus a hint from the model.
4. **Periodic work.** Daily digest, weekly/monthly review, pattern search, reminders to close predictions and revisit decisions, overdue commitments. Some by rules, some with AI.
5. **Ask.** Local search (MiniSearch) + structural filters → top-K objects and the profile → an answer with links.
6. **Without a key.** The copy-paste mode: the app builds a ready prompt with the schema, you paste it into any AI chat and bring the JSON back.
7. **Providers.** Anthropic Messages (primary) and any OpenAI-compatible one (OpenAI, Groq, OpenRouter...). The key stays on the device and is encrypted when the lock is on.
8. **Transparency.** Token and cost counters per day; before sending you can see exactly what will go to the provider.

## 7. Things you did not ask for but need

- **Forecast calibration** (Brier, reliability chart): the main feedback loop for anyone who predicts a lot.
- **Scheduled decision reviews**: "how did it turn out?" turns a journal into learning.
- **Two-way commitments**: especially at work, with clients, partners, family.
- **Your own glossary** for recognition and extraction.
- **Walking mode**: lockable recording, chunks autosaved every 10 s (a crash does not lose a note), recovery of an unfinished recording.
- **Importing AI chats** (paste text; parsing ChatGPT/Claude JSON exports): conversations with an AI stop being a dump.
- **Demo data** and empty states that explain instead of shaming.
- **Lock** (password) and encrypted backup.
- **Search everywhere**, **source links**, a **trash** with 30 days.
- **Installable**: PWA, offline, quick launch straight into recording (`#/capture?autostart=1`), Share target (Android).
- **Accessibility**: AA contrast on glass, respect for `prefers-reduced-motion` and `prefers-reduced-transparency`, large touch targets, keyboard support on desktop.
- **Performance**: blur and effects degrade on weak phones; heavy screens are lazy.

## 8. Out of scope (deliberately)

Native push notifications, calendar/messenger integrations, multi-user use, social features, sharing cards that contain data.
Syncing between your own devices exists as an optional feature ([CLOUD.md](CLOUD.md)).

## 9. Definition of done

1. Voice → saved note → transcript → extraction → review → objects visible in lists and on Today: the full cycle works on a phone (Chrome/Safari) and a desktop.
2. Without an AI key everything except automatic extraction works; the copy-paste mode reaches the same result.
3. "AI context" export yields coherent markdown with the profile, open commitments, decisions, people, patterns.
4. Demo data brings every screen to life.
5. Automated tests of the data layer and the AI pipeline (including garbage model replies), and a clean build with no type errors.
