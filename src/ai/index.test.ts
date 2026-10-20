import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as ai from './index';

const ROOT = join(process.cwd(), 'src', 'ai');

function sources(directory: string): { file: string; text: string }[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && entry.name !== 'testing.ts' ? [{ file: path.slice(ROOT.length + 1), text: readFileSync(path, 'utf8') }] : [];
  });
}

describe('the public surface of the AI layer', () => {
  it('offers everything the features call', () => {
    for (const name of [
      'processCapture',
      'transcribeCapture',
      'generateReview',
      'findPatterns',
      'ask',
      'buildContextPack',
      'parseExport',
      'parsePastedChat',
      'importConversations',
      'createAiServices',
      'createLlmProvider',
      'checkAiReadiness',
      'sharedManualProvider',
      'manualBridge',
      'segmentAnswer',
      'seedBuiltinPresets',
      'NoKeyError',
      'describeError',
    ] as const) {
      expect(typeof ai[name], name).not.toBe('undefined');
    }
  });
});

describe('boundaries of the layer (docs/ARCHITECTURE.md)', () => {
  const files = sources(ROOT);

  it('finds the source files it is supposed to check', () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it('knows nothing about React, the UI, features or Dexie: storage goes through db repositories', () => {
    const forbidden = /from '(?:react|react-dom|dexie|dexie-react-hooks|zustand|motion)(?:\/[^']*)?'|from '\.\.\/(?:\.\.\/)?(?:ui|features|state)\b|from '\.\.\/db\/(?:schema|internal)'/;
    expect(files.filter(({ text }) => forbidden.test(text)).map(({ file }) => file)).toEqual([]);
  });

  it('touches the network only in the HTTP helper', () => {
    expect(files.filter(({ text }) => /\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon/.test(text)).map(({ file }) => file)).toEqual(['http.ts']);
  });

  it('never executes or renders what a model returned', () => {
    const dangerous = /\beval\(|new Function\(|innerHTML|dangerouslySetInnerHTML|document\.write/;
    expect(files.filter(({ text }) => dangerous.test(text)).map(({ file }) => file)).toEqual([]);
  });
});
