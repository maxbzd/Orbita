import { act, cleanup, render, screen } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { updateSettings } from '../db';
import { wipeAll } from '../db/maintenance';
import { seedDemo } from '../db/seed';
import { setLocale } from '../i18n';
import { providerFuture, routerFuture, routes } from '../routes';
import { stubCanvas } from '../ui/testUtils';

/**
 * The whole app in English with the English demo data: no Cyrillic may be left on any main screen.
 * (Languages are always spelled in their own language, on purpose.)
 */

const PATHS = [
  '/today',
  '/stream',
  '/orbit?tab=time',
  '/orbit?tab=people',
  '/orbit?tab=patterns',
  '/items',
  '/items/commitment',
  '/items/decision',
  '/items/prediction',
  '/people',
  '/reviews',
  '/ask',
  '/context',
  '/me',
  '/settings',
  '/checkin',
  '/capture',
  '/onboarding',
];

beforeAll(() => setLocale('en'));
afterAll(() => setLocale('ru'));

beforeEach(async () => {
  stubCanvas();
  await wipeAll();
  await updateSettings({ onboarding: { done: true } });
  await seedDemo();
});

const withoutLanguageNames = (text: string): string => ['Русский', 'Українська', 'Қазақша'].reduce((rest, name) => rest.replaceAll(name, ''), text);

const settle = () => act(async () => new Promise<void>((resolve) => setTimeout(resolve, 250)));

describe('the app in English', () => {
  it.each(PATHS)('has no Russian left on %s', async (path) => {
    const router = createMemoryRouter(routes, { initialEntries: [path], future: routerFuture });
    render(<RouterProvider router={router} future={providerFuture} />);
    await screen.findAllByRole('heading', undefined, { timeout: 5000 });
    await settle();
    const text = withoutLanguageNames(document.body.textContent ?? '');
    const labels = [...document.body.querySelectorAll('[aria-label],[title],[placeholder]')]
      .flatMap((el) => [el.getAttribute('aria-label'), el.getAttribute('title'), el.getAttribute('placeholder')])
      .join(' ');
    expect(text.match(/[А-Яа-яЁё]+/g)?.slice(0, 5) ?? []).toEqual([]);
    expect(labels.match(/[А-Яа-яЁё]+/g)?.slice(0, 5) ?? []).toEqual([]);
    cleanup();
  });
});
