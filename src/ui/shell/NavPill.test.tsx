import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SECTIONS } from './destinations';
import { NavPill } from './NavPill';

const items = SECTIONS.map((d) => ({ id: d.id, label: d.label, icon: d.icon, href: `#${d.to}` }));

describe('NavPill', () => {
  it('is a labelled navigation landmark with the four destinations as links, in order', () => {
    render(<NavPill items={items} activeId="stream" />);
    const nav = screen.getByRole('navigation', { name: 'Основная навигация' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(['Сегодня', 'Поток', 'Орбита', 'Я']);
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['#/today', '#/stream', '#/orbit', '#/me']);
  });

  it('puts the sphere between the second and third destination', () => {
    render(<NavPill items={items} activeId={null} />);
    const nav = screen.getByRole('navigation');
    const order = [...nav.querySelectorAll('a, button')].map((el) => el.textContent || el.getAttribute('aria-label'));
    // the sphere button is absolutely positioned but follows the list in the DOM; tab order is tabs, then sphere
    expect(order).toEqual(['Сегодня', 'Поток', 'Орбита', 'Я', 'Записать']);
  });

  it('marks only the active destination with aria-current="page"', () => {
    render(<NavPill items={items} activeId="orbit" />);
    expect(screen.getByRole('link', { name: 'Орбита' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getAllByRole('link').filter((l) => l.hasAttribute('aria-current'))).toHaveLength(1);
  });

  it('has no current page when the screen is outside the navigation', () => {
    render(<NavPill items={items} activeId={null} />);
    expect(screen.queryByRole('link', { current: 'page' })).toBeNull();
  });

  it('hands a plain click to the router and cancels the browser navigation', () => {
    const onNavigate = vi.fn();
    render(<NavPill items={items} activeId="today" onNavigate={onNavigate} />);
    const notCancelled = fireEvent.click(screen.getByRole('link', { name: 'Поток' }));
    expect(notCancelled).toBe(false); // preventDefault was called
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ id: 'stream', href: '#/stream' }));
  });

  it('leaves modified clicks (new tab) to the browser', () => {
    const onNavigate = vi.fn();
    render(<NavPill items={items} activeId="today" onNavigate={onNavigate} />);
    const notCancelled = fireEvent.click(screen.getByRole('link', { name: 'Поток' }), { ctrlKey: true });
    expect(notCancelled).toBe(true);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('the sphere is a button named "Записать" and starts recording on one tap', () => {
    const onSphereClick = vi.fn();
    render(<NavPill items={items} activeId="today" onSphereClick={onSphereClick} />);
    fireEvent.click(screen.getByRole('button', { name: 'Записать' }));
    expect(onSphereClick).toHaveBeenCalledTimes(1);
  });

  it('renders the Orb slot inside the sphere button instead of the CSS sphere', () => {
    render(<NavPill items={items} activeId="today" sphere={<canvas data-testid="orb" />} />);
    expect(within(screen.getByRole('button', { name: 'Записать' })).getByTestId('orb')).toBeInTheDocument();
  });

  it('when hidden it leaves the accessibility tree and the tab order', () => {
    const { rerender } = render(<NavPill items={items} activeId="today" />);
    expect(screen.getByRole('navigation')).toBeVisible();
    rerender(<NavPill items={items} activeId="today" hidden />);
    expect(screen.queryByRole('navigation')).toBeNull(); // aria-hidden
    const hiddenNav = document.querySelector('nav')!;
    expect(hiddenNav).toHaveAttribute('aria-hidden', 'true');
    expect(hiddenNav).toHaveAttribute('inert');
    expect(hiddenNav).toHaveAttribute('data-hidden');
    rerender(<NavPill items={items} activeId="today" />);
    expect(screen.getByRole('navigation')).not.toHaveAttribute('inert');
  });
});
