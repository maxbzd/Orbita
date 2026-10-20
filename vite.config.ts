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

export default defineConfig({
  base: './',
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  plugins: [
    react(),
    stripCspInDev(),
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
    rollupOptions: {
      // zod 4 ships /*#__PURE__*/ hints Rollup cannot place; harmless, and they would bury real warnings.
      onwarn(warning, warn) {
        if (warning.code === 'INVALID_ANNOTATION' && warning.id?.includes('node_modules')) return;
        warn(warning);
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    // Cloud sync is off unless a Supabase project is configured; the suite runs against a fake one.
    env: { VITE_SUPABASE_URL: 'https://test-project.supabase.co', VITE_SUPABASE_KEY: 'sb_publishable_test' },
    // jsdom screens with many Dexie round-trips can pass 5 s when the whole suite runs in parallel.
    testTimeout: 15000,
  },
});
