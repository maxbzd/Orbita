import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installMatchMedia } from '../../styles/mockMatchMedia';
import type { MatchMediaControl } from '../../styles/mockMatchMedia';
import { stubCanvas } from '../testUtils';
import { AppShell } from './AppShell';
import type { AppShellProps } from './AppShell';
import { ORBIT_LINKS, SECTIONS } from './destinations';
import { useAura, useHideNavigation, useMiniRecorder, useRightPanel, useShell } from './ShellContext';

const sections = SECTIONS.map((d) => ({ id: d.id, label: d.label, icon: d.icon, href: `#${d.to}` }));
const more = ORBIT_LINKS.map((d) => ({ id: d.id, label: d.label, icon: d.icon, href: `#${d.to}` }));

function Shell(props: Partial<AppShellProps> & { children?: ReactNode }) {
  const { children = <h1>Экран</h1>, ...rest } = props;
  return (
    <AppShell sections={sections} more={more} activeId="today" backdrop={null} {...rest}>
      {children}
    </AppShell>
  );
}

let media: MatchMediaControl;
beforeEach(() => {
  stubCanvas();
  media = installMatchMedia({ width: 390 });
});
afterEach(() => media.restore());

describe('AppShell layouts', () => {
  it('phone: the glass pill with the sphere, no rail or sidebar', () => {
    render(<Shell onRecord={() => undefined} />);
    expect(document.querySelector('[data-layout]')).toHaveAttribute('data-layout', 'phone');
    const nav = screen.getByRole('navigation', { name: 'Основная навигация' });
    expect(within(nav).getByRole('button', { name: 'Записать' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Экран' })).toBeInTheDocument();
  });

  it('tablet (768-1279): an icon rail with accessible names, no pill', () => {
    media.setWidth(900);
    render(<Shell />);
    expect(document.querySelector('[data-layout]')).toHaveAttribute('data-layout', 'tablet');
    const rail = screen.getByRole('navigation', { name: 'Основная навигация' });
    expect(within(rail).getByRole('link', { name: 'Поток' })).toHaveAttribute('title', 'Поток');
    expect(within(rail).queryByText('Поток')).toBeNull(); // icons only
  });

  it('desktop (>= 1280): sidebar with sections, people/patterns/reviews and recent entries', () => {
    media.setWidth(1440);
    render(
      <Shell
        recent={[{ id: 'r1', title: 'Разговор с Анной', subtitle: 'вчера', href: '#/entry/r1' }]}
        onRecord={() => undefined}
        onNavigate={() => undefined}
      />,
    );
    expect(document.querySelector('[data-layout]')).toHaveAttribute('data-layout', 'desktop');
    const nav = screen.getByRole('navigation', { name: 'Основная навигация' });
    for (const label of ['Сегодня', 'Поток', 'Орбита', 'Я', 'Люди', 'Паттерны', 'Обзоры']) {
      expect(within(nav).getByRole('link', { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole('link', { name: /Разговор с Анной/ })).toHaveAttribute('href', '#/entry/r1');
    expect(screen.getByRole('button', { name: 'Записать' })).toBeInTheDocument();
  });

  it('desktop: the right panel is a column; on tablet it is a closed sheet until opened', async () => {
    media.setWidth(1440);
    const { rerender } = render(<Shell panel={<p>Подробности записи</p>} panelTitle="Детали" />);
    expect(screen.getByRole('complementary', { name: 'Детали' })).toHaveTextContent('Подробности записи');

    // narrower: the column is gone, and the sheet does not open by itself
    media.setWidth(900);
    rerender(<Shell panel={<p>Подробности записи</p>} panelTitle="Детали" />);
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Детали' })).toBeNull());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('tablet: useRightPanel opens the panel as a right-hand sheet and closing it returns to the page', async () => {
    media.setWidth(900);
    function Opener() {
      const { setOpen } = useRightPanel();
      return <button onClick={() => setOpen(true)}>показать детали</button>;
    }
    render(
      <Shell panel={<p>Подробности записи</p>} panelTitle="Детали">
        <Opener />
      </Shell>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'показать детали' }));
    const dialog = await screen.findByRole('dialog', { name: 'Детали' });
    expect(dialog).toHaveAttribute('data-mode', 'panel');
    expect(dialog).toHaveTextContent('Подробности записи');
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('highlights the active destination in the sidebar and the section in the pill', () => {
    media.setWidth(1440);
    const { unmount } = render(<Shell activeId="people" activeSectionId="orbit" />);
    expect(screen.getByRole('link', { name: 'Люди' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Орбита' })).not.toHaveAttribute('aria-current');
    unmount();

    media.setWidth(390);
    render(<Shell activeId="people" activeSectionId="orbit" />);
    expect(screen.getByRole('link', { name: 'Орбита' })).toHaveAttribute('aria-current', 'page');
  });
});

describe('shell context', () => {
  it('useHideNavigation hides the pill while the screen is mounted and restores it', () => {
    function Recording() {
      useHideNavigation();
      return <h1>Запись</h1>;
    }
    const { rerender } = render(<Shell onRecord={() => undefined} />);
    expect(screen.getByRole('navigation')).toBeInTheDocument();
    rerender(
      <Shell onRecord={() => undefined}>
        <Recording />
      </Shell>,
    );
    expect(screen.queryByRole('navigation')).toBeNull();
    rerender(<Shell onRecord={() => undefined} />);
    expect(screen.getByRole('navigation')).toBeInTheDocument();
  });

  it('hiding is counted: two screens holding the navigation hidden release one by one', () => {
    function Hider({ id }: { id: string }) {
      useHideNavigation();
      return <p>{id}</p>;
    }
    const { rerender } = render(
      <Shell>
        <Hider id="a" />
        <Hider id="b" />
      </Shell>,
    );
    expect(screen.queryByRole('navigation')).toBeNull();
    rerender(
      <Shell>
        <Hider id="a" />
      </Shell>,
    );
    expect(screen.queryByRole('navigation')).toBeNull();
    rerender(<Shell>{null}</Shell>);
    expect(screen.getByRole('navigation')).toBeInTheDocument();
  });

  it('hides the navigation on wide layouts too', () => {
    media.setWidth(1440);
    function Onboarding() {
      useHideNavigation();
      return <h1>Знакомство</h1>;
    }
    render(
      <Shell>
        <Onboarding />
      </Shell>,
    );
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('the mini recorder slot shows above the pill only while a screen asks for it', () => {
    function Playing() {
      useMiniRecorder();
      return <p>играет</p>;
    }
    const mini = <div data-testid="mini">Идёт запись 02:14</div>;
    const { rerender } = render(<Shell miniRecorder={mini} />);
    expect(screen.queryByTestId('mini')).toBeNull();
    rerender(
      <Shell miniRecorder={mini}>
        <Playing />
      </Shell>,
    );
    expect(screen.getByTestId('mini')).toBeInTheDocument();
  });

  it('on wide screens the same request shows the dock (or falls back to the mini recorder)', () => {
    media.setWidth(1440);
    function Playing() {
      useMiniRecorder();
      return null;
    }
    render(
      <Shell dock={<div data-testid="dock">док</div>} miniRecorder={<div data-testid="mini">мини</div>}>
        <Playing />
      </Shell>,
    );
    expect(screen.getByTestId('dock')).toBeInTheDocument();
    expect(screen.queryByTestId('mini')).toBeNull();
  });

  it('keeps toasts above the fixed bar through --toast-offset, and cleans up', () => {
    const { unmount } = render(<Shell />);
    expect(document.documentElement.style.getPropertyValue('--toast-offset')).toBe('74px');
    unmount();
    expect(document.documentElement.style.getPropertyValue('--toast-offset')).toBe('');
  });

  it('useRightPanel toggles the panel; useAura feeds the backdrop and restores the default on leave', () => {
    const seen: Array<ReturnType<typeof useShell>['aura']> = [];
    function Probe() {
      const { open, toggle } = useRightPanel();
      const { aura } = useShell();
      seen.push(aura);
      return (
        <button onClick={toggle} aria-pressed={open}>
          панель
        </button>
      );
    }
    function Screen() {
      useAura(0.7, 0.9, 'full');
      return null;
    }
    media.setWidth(1440);
    const { rerender } = render(
      <Shell panel={<p>p</p>}>
        <Probe />
        <Screen />
      </Shell>,
    );
    const last = () => seen[seen.length - 1]!;
    expect(last()).toEqual({ mood: 0.7, intensity: 0.9, extent: 'full' });
    expect(screen.getByRole('button', { name: 'панель' })).toHaveAttribute('aria-pressed', 'true'); // desktop default: open
    fireEvent.click(screen.getByRole('button', { name: 'панель' }));
    expect(screen.queryByRole('complementary')).toBeNull();

    rerender(
      <Shell panel={<p>p</p>}>
        <Probe />
      </Shell>,
    );
    expect(last()).toEqual({ mood: 0, intensity: 0.5, extent: 'hero' });
  });

  it('shell hooks are harmless outside a shell', () => {
    function Alone() {
      useHideNavigation();
      useMiniRecorder();
      useAura(0, 1);
      return <p>без оболочки</p>;
    }
    expect(() => render(<Alone />)).not.toThrow();
  });
});

describe('navigation and shortcuts', () => {
  it('passes plain link clicks to onNavigate', () => {
    const onNavigate = vi.fn();
    render(<Shell onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole('link', { name: 'Орбита' }));
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ id: 'orbit' }));
  });

  it('the sphere starts recording, and so does Ctrl+Shift+R', () => {
    const onRecord = vi.fn();
    render(<Shell onRecord={onRecord} />);
    fireEvent.click(screen.getByRole('button', { name: 'Записать' }));
    expect(onRecord).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: 'R', ctrlKey: true, shiftKey: true });
    expect(onRecord).toHaveBeenCalledTimes(2);
  });

  it('Ctrl+K opens the command palette and a second press closes it', async () => {
    render(<Shell onNavigate={() => undefined} onRecord={() => undefined} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    expect(await screen.findByRole('dialog', { name: 'Командная палитра' })).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toHaveFocus();
    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('the palette lists navigation and the record action by default, and runs them', async () => {
    const onNavigate = vi.fn();
    const onRecord = vi.fn();
    render(<Shell onNavigate={onNavigate} onRecord={onRecord} />);
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    const list = await screen.findByRole('listbox');
    const names = within(list).getAllByRole('option').map((o) => o.textContent);
    expect(names[0]).toContain('Новая запись');
    expect(names.some((n) => n?.includes('Паттерны'))).toBe(true);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'люди' } });
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ id: 'people' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('an unmodified "k" or Ctrl+Shift+K does not open the palette', () => {
    render(<Shell />);
    fireEvent.keyDown(document, { key: 'k' });
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true, shiftKey: true });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('the skip link moves focus to the main region', () => {
    render(<Shell />);
    fireEvent.click(screen.getByRole('button', { name: 'Перейти к содержимому' }));
    expect(screen.getByRole('main')).toHaveFocus();
  });

  it('a new routeKey remounts the page so it cross-fades in', () => {
    function Counter() {
      const [n] = useState(() => Math.random());
      return <p data-testid="page">{n}</p>;
    }
    const { rerender } = render(<Shell routeKey="today"><Counter /></Shell>);
    const first = screen.getByTestId('page').textContent;
    rerender(<Shell routeKey="today"><Counter /></Shell>);
    expect(screen.getByTestId('page').textContent).toBe(first); // same key: kept
    rerender(<Shell routeKey="stream"><Counter /></Shell>);
    expect(screen.getByTestId('page').textContent).not.toBe(first);
  });
});
