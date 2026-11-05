import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/** Dark placeholder shared by the manifest and index.html until design tokens land. */
const BACKGROUND_COLOR = '#07080f';

/**
 * The CSP <meta> in index.html is for production builds only: the dev server needs
 * inline scripts (React Refresh preamble) and a websocket for HMR.
 */
function stripCspInDev(): Plugin {
  return {
    name: 'orbit:strip-csp-in-dev',
    apply: 'serve',
    transformIndexHtml: (html) =>
      html.replace(/<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?>/, ''),
  };
}

/** Puts the build's name in the page (`BUILD_TAG`), so that a test can tell two builds of the same code apart. */
function buildTag(): Plugin {
  return {
    name: 'orbita:build-tag',
    apply: 'build',
    transformIndexHtml: () => [{ tag: 'meta', attrs: { name: 'build', content: process.env.BUILD_TAG ?? '' }, injectTo: 'head' as const }],
  };
}

/**
 * The two fonts the first screen is drawn in are announced in the page head: otherwise the browser only learns of them
 * once the app has drawn its first text, and the text waits for them.
 */
function preloadFonts(names: string[]): Plugin {
  return {
    name: 'orbita:preload-fonts',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const files = Object.keys(ctx.bundle ?? {}).filter((file) => file.endsWith('.woff2') && names.some((name) => file.includes(`/${name}-`)));
        return files.map((file) => ({ tag: 'link', attrs: { rel: 'preload', as: 'font', type: 'font/woff2', crossorigin: '', href: `./${file}` }, injectTo: 'head' as const }));
      },
    },
  };
}

export default defineConfig({
  base: './',
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  plugins: [
    react(),
    stripCspInDev(),
    buildTag(),
    preloadFonts(['onest-latin-wght-normal', 'cormorant-garamond-latin-wght-normal']),
    VitePWA({
      // 'prompt': a new service worker waits for the next launch instead of reloading the
      // page mid-recording. A UI for "update available" can use virtual:pwa-register later.
      registerType: 'prompt',
      includeAssets: ['icons/icon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        id: './',
        name: 'Orbita',
        short_name: 'Orbita',
        description: 'A personal system for making sense of life and work: voice, records, decisions, commitments.',
        lang: 'en',
        dir: 'ltr',
        start_url: './#/',
        scope: './',
        display: 'standalone',
        background_color: BACKGROUND_COLOR,
        theme_color: BACKGROUND_COLOR,
        categories: ['productivity', 'lifestyle'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          {
            name: 'New recording',
            short_name: 'Record',
            url: './#/capture?autostart=1',
            icons: [{ src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
          },
          {
            name: 'Check-in',
            short_name: 'Check-in',
            url: './#/checkin',
            icons: [{ src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
          },
        ],
        // Android "Share" target. The browser appends ?title=&text=&url= before the fragment
        // (https://host/app/?text=...#/share), so the share screen must read window.location.search.
        share_target: {
          action: './#/share',
          method: 'GET',
          params: { title: 'title', text: 'text', url: 'url' },
        },
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,webmanifest}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: {
    // one stylesheet instead of five requests that each block the first paint
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        // What only some screens need is kept out of the chunk that every launch downloads: the AI pipeline and the search index
        // are fetched when a screen asks for them, not at startup.
        manualChunks(id: string) {
          if (id.includes('node_modules/minisearch')) return 'search';
          if (/node_modules\/react-router/.test(id)) return 'router';
          return undefined;
        },
      },
      // zod 4 ships /*#__PURE__*/ hints Rollup cannot place; harmless, and they would bury real warnings.
      onwarn(warning, warn) {
        if (warning.code === 'INVALID_ANNOTATION' && warning.id?.includes('node_modules')) return;
        warn(warning);
      },
    },
  },
  test: {
    alias: { 'virtual:pwa-register': fileURLToPath(new URL('./src/test-stubs/pwa-register.ts', import.meta.url)) },
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/main.tsx', 'src/devtools.ts', 'src/test-stubs/**', 'src/**/*.test.{ts,tsx}', 'src/**/*.d.ts', 'src/test-setup.ts'],
      reporter: ['text-summary', 'json-summary'],
      // a floor, not a goal: coverage may only go up (measured 86.8 / 79.4 / 83.2 / 88.9 on 5 Nov 2026, test files not counted)
      thresholds: { statements: 86, branches: 79, functions: 82, lines: 88 },
    },
    // Cloud sync is off unless a Supabase project is configured; the suite runs against a fake one.
    env: { VITE_SUPABASE_URL: 'https://test-project.supabase.co', VITE_SUPABASE_KEY: 'sb_publishable_test' },
    // jsdom screens with many Dexie round-trips can pass 5 s when the whole suite runs in parallel.
    testTimeout: 15000,
  },
});
