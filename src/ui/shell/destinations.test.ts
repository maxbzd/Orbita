import { describe, expect, it } from 'vitest';
import { ORBIT_LINKS, SECTIONS, destinationForPath, sectionOf } from './destinations';

describe('destinationForPath', () => {
  it.each([
    ['/today', 'today'],
    ['/checkin', 'today'],
    ['/stream', 'stream'],
    ['/entry/abc', 'stream'],
    ['/review/abc', 'stream'],
    ['/ask', 'stream'],
    ['/orbit', 'orbit'],
    ['/items/commitment', 'orbit'],
    ['/people/p1', 'people'],
    ['/patterns', 'patterns'],
    ['/reviews/r1', 'reviews'],
    ['/me', 'me'],
    ['/settings', 'me'],
    ['/context', 'me'],
  ])('%s belongs to %s', (path, destination) => {
    expect(destinationForPath(path)).toBe(destination);
  });

  it('is null for the recording screen, onboarding, the root and unknown paths', () => {
    for (const path of ['/', '/capture', '/onboarding', '/share', '/nowhere', '']) {
      expect(destinationForPath(path)).toBeNull();
    }
  });

  it('does not confuse /review (one capture) with /reviews (weekly reviews)', () => {
    expect(destinationForPath('/review/x')).not.toBe(destinationForPath('/reviews/x'));
  });
});

describe('sectionOf', () => {
  it('folds people, patterns and reviews into Орбита and leaves the rest alone', () => {
    expect(sectionOf('people')).toBe('orbit');
    expect(sectionOf('patterns')).toBe('orbit');
    expect(sectionOf('reviews')).toBe('orbit');
    expect(sectionOf('today')).toBe('today');
    expect(sectionOf('me')).toBe('me');
    expect(sectionOf(null)).toBeNull();
  });
});

describe('navigation tables', () => {
  it('has the four labelled sections in the documented order', () => {
    expect(SECTIONS.map((s) => s.label)).toEqual(['Сегодня', 'Поток', 'Орбита', 'Я']);
    expect(ORBIT_LINKS.map((s) => s.label)).toEqual(['Люди', 'Паттерны', 'Обзоры']);
  });

  it('every entry resolves back to itself through its own path', () => {
    for (const d of [...SECTIONS, ...ORBIT_LINKS]) expect(destinationForPath(d.to)).toBe(d.id);
  });
});
