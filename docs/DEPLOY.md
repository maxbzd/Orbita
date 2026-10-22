# Hosting your own copy

Orbita is a static site: `npm run build` produces `dist/`, which any static host can serve. There is no server component. Paths are
relative (`base: './'`), so it works from the root of a domain or from a sub-path.

```bash
git clone https://github.com/maxbzd/Orbita.git && cd Orbita
npm ci
cp .env.example .env     # optional: cloud sync values, see CLOUD.md
npm run build            # type check + production build in dist/
```

Serve it over **HTTPS**: the microphone, the service worker and "Add to Home Screen" all require a secure context
(`localhost` counts as secure for local tests).

## GitHub Pages (automatic)

1. Fork the repository.
2. Settings → Pages → Build and deployment → Source: **GitHub Actions**.
3. Every push to `main` runs `.github/workflows/deploy.yml`: install, i18n check, tests, build, publish.

If you use cloud sync, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_KEY` as repository **variables** (Settings → Secrets and variables →
Actions → Variables) and pass them in the build step's `env`. They are public values; never add a `service_role` key.

## Netlify, Cloudflare Pages, Vercel, any static host

Build command `npm run build`, publish directory `dist`, Node 22.23.4 or newer (set `NODE_VERSION` on your host). No redirects are needed: the app uses a hash router (`#/...`).

## On your own machine or network

`npm run preview` serves the production build (add `-- --host` to reach it from a phone on the same network; the microphone needs HTTPS,
so for phone tests use a tunnel or a real host).

## Using your own AI server

The Content-Security-Policy in `index.html` allows requests only to the listed hosts (`api.anthropic.com`, `api.openai.com`, `api.groq.com`,
`openrouter.ai`, Supabase). To use another OpenAI-compatible server (a local Ollama, a proxy), add its origin to `connect-src` in
`index.html` **before building**. A `<meta>` CSP cannot be loosened at runtime; that is deliberate.

## Updating

The service worker is registered with `registerType: 'prompt'`: a new version waits for the next launch instead of reloading the page in the
middle of a recording. Your data lives in the browser and is untouched by updates.

## Installing on a phone

Open the site in Chrome (Android) or Safari (iPhone) → **Add to Home Screen**. Android adds shortcuts for *New recording* and
*Check-in*, and Orbita appears in the system **Share** menu (text sent to it becomes a note).
