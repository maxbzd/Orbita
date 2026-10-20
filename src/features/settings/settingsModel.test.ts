import { describe, expect, it } from 'vitest';
import { installHint } from './about';
import { APP_VERSION } from './AboutSection';
import { backupSummaryLine, checkCsp, formatCost, maskKey, nearestAutoAcceptStep, parseBaseUrl, readCspConnectOrigins, totalUsage } from './settingsModel';
import pkg from '../../../package.json';

describe('maskKey', () => {
  it('shows at most the last four characters', () => {
    expect(maskKey('sk-ant-api03-abcdefghijklmnop-a3f9')).toBe('••••••••a3f9');
    expect(maskKey('sk-ant-api03-abcdefghijklmnop-a3f9')).not.toContain('abcdef');
  });
  it('shows nothing of a short key and nothing for no key', () => {
    expect(maskKey('short')).toBe('••••••••');
    expect(maskKey('   ')).toBe('');
  });
});

describe('parseBaseUrl', () => {
  it('accepts https and localhost over http only', () => {
    expect(parseBaseUrl('https://api.groq.com/openai/v1')).toMatchObject({ ok: true, origin: 'https://api.groq.com' });
    expect(parseBaseUrl('http://localhost:11434/v1')).toMatchObject({ ok: true, host: 'localhost:11434' });
    expect(parseBaseUrl('http://example.com/v1').ok).toBe(false);
    expect(parseBaseUrl('not a url').ok).toBe(false);
    expect(parseBaseUrl('  ').ok).toBe(false);
  });
});

describe('Content-Security-Policy check', () => {
  const meta = (content: string): Document => {
    const doc = document.implementation.createHTMLDocument('x');
    const tag = doc.createElement('meta');
    tag.setAttribute('http-equiv', 'Content-Security-Policy');
    tag.setAttribute('content', content);
    doc.head.append(tag);
    return doc;
  };
  const csp = "default-src 'self'; connect-src 'self' https://api.anthropic.com https://api.openai.com; img-src 'self'";

  it('reads the origins of connect-src and ignores keywords', () => {
    expect(readCspConnectOrigins(meta(csp))).toEqual(['https://api.anthropic.com', 'https://api.openai.com']);
  });

  it('is unrestricted (null) without a policy, as on the dev server', () => {
    expect(readCspConnectOrigins(document.implementation.createHTMLDocument('x'))).toBeNull();
    expect(checkCsp('https://anything.example/v1', null)).toEqual({ status: 'ok' });
  });

  it('flags a host that is not on the list, and passes one that is', () => {
    const allowed = readCspConnectOrigins(meta(csp));
    expect(checkCsp('https://api.openai.com/v1', allowed)).toEqual({ status: 'ok' });
    expect(checkCsp('https://llm.example.org/v1', allowed)).toEqual({ status: 'blocked', origin: 'https://llm.example.org' });
    expect(checkCsp('oops', allowed).status).toBe('invalid');
  });
});

describe('usage totals and cost', () => {
  it('adds the days up', () => {
    const total = totalUsage([
      { day: '2026-10-06', calls: 2, inputTokens: 1000, outputTokens: 200, audioSec: 0, costUsd: 0.004 },
      { day: '2026-10-07', calls: 1, inputTokens: 500, outputTokens: 100, audioSec: 30, costUsd: 0.002 },
    ]);
    expect(total).toEqual({ calls: 3, inputTokens: 1500, outputTokens: 300, audioSec: 30, costUsd: 0.006 });
  });
  it('formats small and zero costs honestly', () => {
    expect(formatCost(0)).toBe('—');
    expect(formatCost(0.004)).toBe('≈ <$0,01');
    expect(formatCost(1.236)).toBe('≈ $1,24');
  });
});

describe('small helpers', () => {
  it('picks the nearest auto-accept step', () => {
    expect(nearestAutoAcceptStep(0.85)).toBe(0.85);
    expect(nearestAutoAcceptStep(0.5)).toBe(0.7);
    expect(nearestAutoAcceptStep(0.93)).toBe(0.95);
  });
  it('describes a backup in Russian plurals', () => {
    expect(backupSummaryLine({ captures: 21, items: 3, people: 0 })).toBe('21 запись, 3 объекта');
    expect(backupSummaryLine({})).toBe('пусто');
  });
  it('knows how to install per platform', () => {
    expect(installHint('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)', false).platform).toBe('ios');
    expect(installHint('Mozilla/5.0 (Linux; Android 14)', false).steps.join(' ')).toMatch(/Chrome/);
    expect(installHint('Mozilla/5.0 (X11; Linux x86_64)', true).title).toMatch(/уже установлено/);
  });
  it('shows the version of package.json', () => {
    expect(APP_VERSION).toBe(pkg.version);
  });
});
