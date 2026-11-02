import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Navigate, RouterProvider, createMemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { capturesRepo, updateSettings } from '../../db';
import { wipeAll } from '../../db/maintenance';
import { App } from '../../App';
import { RoutedShell } from '../../ui';
import { stubCanvas } from '../../ui/testUtils';
import { routes as todayRoutes } from '../today';
import { routes as onboardingRoutes } from './index';
import { FIRST_RUN_EXEMPT, needsOnboarding } from './firstRun';

// The same opt-ins as the real router (src/routes.tsx), repeated so this test does not load every feature.

const fresh = { onboarding: { done: false } };
const finished = { onboarding: { done: true } };

describe('needsOnboarding', () => {
  it('sends a first launch to the onboarding from anywhere', () => {
    expect(needsOnboarding({ settings: fresh, pathname: '/today', hasRecords: false })).toBe(true);
    expect(needsOnboarding({ settings: fresh, pathname: '/stream', hasRecords: false })).toBe(true);
    expect(needsOnboarding({ settings: fresh, pathname: '/', hasRecords: false })).toBe(true);
  });

  it('leaves the onboarding itself and the recording screen alone', () => {
    expect(FIRST_RUN_EXEMPT).toEqual(expect.arrayContaining(['/onboarding', '/capture']));
    expect(needsOnboarding({ settings: fresh, pathname: '/onboarding', hasRecords: false })).toBe(false);
    expect(needsOnboarding({ settings: fresh, pathname: '/capture', hasRecords: false })).toBe(false);
  });

  it('does nothing once the onboarding is done', () => {
    expect(needsOnboarding({ settings: finished, pathname: '/today', hasRecords: false })).toBe(false);
  });

  it('does not make someone with records go through it', () => {
    expect(needsOnboarding({ settings: fresh, pathname: '/today', hasRecords: true })).toBe(false);
  });
});

describe('first-run redirect in the app', () => {
  beforeEach(async () => {
    stubCanvas();
    await wipeAll();
  });

  /** The real root layout and shell with the two screens that matter here and stand-ins for the rest. */
  const routes = [
    {
      path: '/',
      element: <App />,
      children: [
        {
          element: <RoutedShell />,
          children: [
            ...onboardingRoutes,
            ...todayRoutes,
            { path: 'stream', element: <h1>Поток</h1> },
            { path: 'capture', element: <h1>Запись</h1> },
            { index: true, element: <Navigate to="/today" replace /> },
          ],
        },
      ],
    },
  ];

  function open(path: string) {
    const router = createMemoryRouter(routes, { initialEntries: [path] });
    render(<RouterProvider router={router} />);
    return router;
  }

  it('opens the onboarding on the first launch', async () => {
    const router = open('/today');
    await waitFor(() => expect(router.state.location.pathname).toBe('/onboarding'), { timeout: 5000 });
    expect(await screen.findByRole('heading', { name: 'Говори. Я разложу.' }, { timeout: 5000 })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('navigation', { name: 'Основная навигация' })).toBeNull());
  });

  it('opens the home screen once the onboarding is done', async () => {
    await updateSettings({ onboarding: { done: true } });
    const router = open('/');
    expect(await screen.findByRole('region', { name: 'Сегодня' }, { timeout: 5000 })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/today');
  });

  it('does not bounce the recording screen', async () => {
    const router = open('/capture');
    // Give the settings a moment to load: a redirect would show up by now.
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(router.state.location.pathname).toBe('/capture');
  });

  it('lets a user with records straight in', async () => {
    await capturesRepo.create({ kind: 'text', text: 'Раньше уже писал', status: 'done' });
    const router = open('/stream');
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(router.state.location.pathname).toBe('/stream');
  });
});

describe('Safari deletes a site\'s data after 7 idle days', () => {
  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const routes = [
    {
      path: '/',
      element: <App />,
      children: [{ element: <RoutedShell />, children: [...onboardingRoutes, ...todayRoutes] }],
    },
  ];
  const open = (path: string) => render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />);

  beforeEach(async () => {
    stubCanvas();
    await wipeAll();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('on iPhone in a tab the onboarding asks to install before it asks for a name', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(IPHONE);
    open('/onboarding');
    fireEvent.click(await screen.findByRole('button', { name: 'Начать' }, { timeout: 5000 }));
    expect(await screen.findByRole('heading', { name: 'Добавь Orbita на экран «Домой»' }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText(/Нажми «Поделиться»|Нажми «Поделиться»|Поделиться/)).toBeInTheDocument();
    expect(screen.queryByText('Привет. Как тебя зовут?')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Продолжить без установки' }));
    expect(await screen.findByText('Привет. Как тебя зовут?')).toBeInTheDocument();
  });

  it('the back button leaves the install screen for the first one', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(IPHONE);
    open('/onboarding');
    fireEvent.click(await screen.findByRole('button', { name: 'Начать' }, { timeout: 5000 }));
    await screen.findByRole('heading', { name: 'Добавь Orbita на экран «Домой»' }, { timeout: 5000 });
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(await screen.findByRole('button', { name: 'Начать' })).toBeInTheDocument();
  });

  it('elsewhere the onboarding goes straight to the name', async () => {
    open('/onboarding');
    fireEvent.click(await screen.findByRole('button', { name: 'Начать' }, { timeout: 5000 }));
    expect(await screen.findByText('Привет. Как тебя зовут?')).toBeInTheDocument();
  });

  it('the home screen keeps reminding on iPhone in a tab, and can be told to wait', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(IPHONE);
    await updateSettings({ onboarding: { done: true } });
    open('/today');
    expect(await screen.findByText('Safari может удалить твои данные', undefined, { timeout: 5000 })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Как' }));
    expect(await screen.findByText(/Открой Orbita с новой иконки/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Напомнить позже' }));
    await waitFor(() => expect(screen.queryByText('Safari может удалить твои данные')).toBeNull());
  });

  it('no reminder where the data is safe', async () => {
    await updateSettings({ onboarding: { done: true } });
    open('/today');
    await screen.findByRole('region', { name: 'Сегодня' }, { timeout: 5000 });
    expect(screen.queryByText('Safari может удалить твои данные')).toBeNull();
  });
});

