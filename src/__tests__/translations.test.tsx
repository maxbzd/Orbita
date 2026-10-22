import { act, cleanup, render, screen } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { updateSettings } from '../db';
import { wipeAll } from '../db/maintenance';
import { seedDemo } from '../db/seed';
import { detectLocale, registerDictionary, setLocale, tn } from '../i18n';
import type { Dictionary, Locale } from '../i18n';
import de from '../i18n/locales/de.json';
import es from '../i18n/locales/es.json';
import fr from '../i18n/locales/fr.json';
import pt from '../i18n/locales/pt.json';
import ru from '../i18n/locales/ru.json';
import uk from '../i18n/locales/uk.json';
import { providerFuture, routerFuture, routes } from '../routes';
import { stubCanvas } from '../ui/testUtils';

/** Every dictionary has the messages of the Russian reference and the same placeholders; the Latin-script ones leave no Cyrillic on screen. */

const DICTIONARIES: ReadonlyArray<[Exclude<Locale, 'en' | 'ru'>, Dictionary]> = [
  ['es', es as Dictionary],
  ['de', de as Dictionary],
  ['fr', fr as Dictionary],
  ['pt', pt as Dictionary],
  ['uk', uk as Dictionary],
];

const placeholders = (text: string): string => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();

afterAll(() => setLocale('ru'));

describe('translations', () => {
  it.each(DICTIONARIES)('%s has every message of the reference with the same placeholders', (_id, dictionary) => {
    const problems: string[] = [];
    for (const [key, reference] of Object.entries(ru as Dictionary)) {
      const entry = dictionary[key];
      if (entry === undefined) {
        problems.push(`missing: ${key}`);
        continue;
      }
      if (Array.isArray(entry) !== Array.isArray(reference)) {
        problems.push(`shape: ${key}`);
        continue;
      }
      if (typeof entry === 'string' && placeholders(entry) !== placeholders(key.includes('\u0004') ? key.split('\u0004')[1]! : key)) {
        problems.push(`placeholders: ${key}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('picks the first supported language of the browser', () => {
    expect(detectLocale(['pl-PL', 'de-AT', 'en'])).toBe('de');
    expect(detectLocale(['pt-BR'])).toBe('pt');
    expect(detectLocale(['uk', 'ru'])).toBe('uk');
    expect(detectLocale(['ja'])).toBe('en');
  });

  it('chooses Ukrainian plural forms by the language rules', () => {
    const probe = 'plural probe {n}'; // a variable on purpose: the i18n checker must not mistake it for a message of the app
    registerDictionary('uk', { [probe]: ['{n} день', '{n} дні', '{n} днів', '{n} дня'] });
    setLocale('uk');
    expect([1, 2, 5, 21, 22, 25].map((n) => tn(n, probe, 'unused'))).toEqual(['1 день', '2 дні', '5 днів', '21 день', '22 дні', '25 днів']);
    registerDictionary('uk', uk as Dictionary);
    setLocale('ru');
  });
});

const PATHS = ['/today', '/stream', '/orbit?tab=people', '/items', '/people', '/reviews', '/ask', '/me', '/settings', '/onboarding'];
const LATIN = DICTIONARIES.filter(([id]) => id !== 'uk');
const settle = () => act(async () => new Promise<void>((resolve) => setTimeout(resolve, 250)));
const withoutLanguageNames = (text: string): string => ['Русский', 'Українська', 'Қазақша'].reduce((rest, name) => rest.replaceAll(name, ''), text);

describe.each(LATIN)('the app in %s', (id, dictionary) => {
  beforeEach(async () => {
    registerDictionary(id, dictionary);
    setLocale(id);
    stubCanvas();
    await wipeAll();
    await updateSettings({ onboarding: { done: true } });
    await seedDemo();
  });

  it.each(PATHS)('has no Cyrillic left on %s', async (path) => {
    const router = createMemoryRouter(routes, { initialEntries: [path], future: routerFuture });
    render(<RouterProvider router={router} future={providerFuture} />);
    await screen.findAllByRole('heading', undefined, { timeout: 5000 });
    await settle();
    const text = withoutLanguageNames(document.body.textContent ?? '');
    expect(text.match(/[А-Яа-яЁё]+/g)?.slice(0, 5) ?? []).toEqual([]);
    expect(document.documentElement.lang).toBe(id);
    cleanup();
  });
});
