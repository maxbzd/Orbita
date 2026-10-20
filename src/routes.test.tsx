import { cleanup, render, screen, within } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { updateSettings } from './db';
import { wipeAll } from './db/maintenance';
import { providerFuture, routerFuture, routes } from './routes';
import { stubCanvas } from './ui/testUtils';

// A first launch is sent to the onboarding: these tests are about a user who has been through it.
beforeEach(async () => {
  stubCanvas();
  await wipeAll();
  await updateSettings({ onboarding: { done: true } });
});

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path], future: routerFuture });
  render(<RouterProvider router={router} future={providerFuture} />);
  return router;
}

describe('route table', () => {
  it('opens the home screen from the root', async () => {
    const router = renderAt('/');
    expect(await screen.findByRole('region', { name: 'Сегодня' }, { timeout: 5000 })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/today');
  });

  it.each([
    ['/capture?autostart=1', 'Запись'],
    ['/checkin', 'Как ты сейчас?'],
    ['/share?text=hello', 'Сохранить в Орбиту?'],
    ['/stream', 'Поток'],
    ['/orbit', 'Время'],
    ['/people', 'Люди'],
    ['/patterns', 'Паттерны'],
    ['/settings', 'Настройки'],
  ])('serves %s', async (path, title) => {
    renderAt(path);
    expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument();
  });

  it('shows a Russian "not found" page with a way home', async () => {
    renderAt('/nowhere/at/all');
    expect(await screen.findByRole('heading', { name: 'Такой страницы нет' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'На главную' })).toHaveAttribute('href', '/today');
  });

  it('shows the navigation on a regular screen and leaves it out of the recording screen', async () => {
    const today = renderAt('/today');
    expect(await screen.findByRole('region', { name: 'Сегодня' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Основная навигация' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    today.dispose();
    cleanup();

    renderAt('/capture');
    expect(await screen.findByRole('heading', { name: 'Запись' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });

  it('marks the section of the current URL in the navigation', async () => {
    renderAt('/people/abc');
    await screen.findByText('Такого человека нет.');
    const nav = screen.getByRole('navigation', { name: 'Основная навигация' });
    expect(within(nav).queryAllByRole('link', { current: 'page' })).not.toHaveLength(0);
  });
});
