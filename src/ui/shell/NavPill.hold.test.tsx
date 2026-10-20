import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installPointerEvent } from '../../state/testing';
import { SECTIONS } from './destinations';
import { HOLD_MS, NavPill } from './NavPill';
import type { SphereGesture } from './NavPill';

const items = SECTIONS.map((d) => ({ id: d.id, label: d.label, icon: d.icon, href: `#${d.to}` }));

beforeEach(() => {
  installPointerEvent();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

function gesture(): SphereGesture & { [K in keyof SphereGesture]-?: ReturnType<typeof vi.fn> } {
  return { onHoldStart: vi.fn(), onHoldMove: vi.fn(), onHoldEnd: vi.fn(), onHoldCancel: vi.fn(), onMenuKey: vi.fn() };
}

const sphere = (): HTMLElement => screen.getByRole('button', { name: 'Записать' });

describe('press and hold on the sphere', () => {
  it('a plain tap still records, at once, and opens nothing', () => {
    const onSphereClick = vi.fn();
    const g = gesture();
    render(<NavPill items={items} activeId={null} onSphereClick={onSphereClick} sphereGesture={g} />);

    fireEvent.pointerDown(sphere(), { pointerId: 1, clientX: 195, clientY: 800 });
    act(() => void vi.advanceTimersByTime(HOLD_MS - 80));
    fireEvent.pointerUp(sphere(), { pointerId: 1, clientX: 195, clientY: 800 });
    fireEvent.click(sphere());

    expect(onSphereClick).toHaveBeenCalledTimes(1);
    expect(g.onHoldStart).not.toHaveBeenCalled();
  });

  it('holding opens the gesture over the finger, follows it, and ends on lift without starting a recording', () => {
    const onSphereClick = vi.fn();
    const g = gesture();
    render(<NavPill items={items} activeId={null} onSphereClick={onSphereClick} sphereGesture={g} />);

    fireEvent.pointerDown(sphere(), { pointerId: 1, clientX: 195, clientY: 800 });
    act(() => void vi.advanceTimersByTime(HOLD_MS));
    expect(g.onHoldStart).toHaveBeenCalledWith({ x: 195, y: 800 }, expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }));

    fireEvent.pointerMove(sphere(), { pointerId: 1, clientX: 230, clientY: 710 });
    expect(g.onHoldMove).toHaveBeenCalledWith({ x: 230, y: 710 });

    fireEvent.pointerUp(sphere(), { pointerId: 1, clientX: 230, clientY: 710 });
    expect(g.onHoldEnd).toHaveBeenCalledWith({ x: 230, y: 710 });
    // The click that the lift produces is swallowed: no recording starts behind the arc.
    fireEvent.click(sphere());
    expect(onSphereClick).not.toHaveBeenCalled();

    // The next tap is a normal tap again.
    act(() => void vi.advanceTimersByTime(5));
    fireEvent.click(sphere());
    expect(onSphereClick).toHaveBeenCalledTimes(1);
  });

  it('a finger that drifts away before the hold is a scroll, not a hold', () => {
    const g = gesture();
    render(<NavPill items={items} activeId={null} sphereGesture={g} />);
    fireEvent.pointerDown(sphere(), { pointerId: 1, clientX: 195, clientY: 800 });
    fireEvent.pointerMove(sphere(), { pointerId: 1, clientX: 195, clientY: 760 });
    act(() => void vi.advanceTimersByTime(HOLD_MS * 2));
    expect(g.onHoldStart).not.toHaveBeenCalled();
  });

  it('a pointer taken away by the system cancels the hold', () => {
    const g = gesture();
    render(<NavPill items={items} activeId={null} sphereGesture={g} />);
    fireEvent.pointerDown(sphere(), { pointerId: 1, clientX: 195, clientY: 800 });
    act(() => void vi.advanceTimersByTime(HOLD_MS));
    fireEvent.pointerCancel(sphere(), { pointerId: 1 });
    expect(g.onHoldCancel).toHaveBeenCalled();
    expect(g.onHoldEnd).not.toHaveBeenCalled();
  });

  it('opens the same actions from the keyboard: ArrowUp, the context-menu key or Shift+F10', () => {
    const g = gesture();
    render(<NavPill items={items} activeId={null} sphereGesture={g} />);
    fireEvent.keyDown(sphere(), { key: 'ArrowUp' });
    fireEvent.keyDown(sphere(), { key: 'ContextMenu' });
    fireEvent.keyDown(sphere(), { key: 'F10', shiftKey: true });
    fireEvent.keyDown(sphere(), { key: 'ArrowDown' });
    expect(g.onMenuKey).toHaveBeenCalledTimes(3);
  });

  it('keeps the native long-press menu away from the sphere', () => {
    render(<NavPill items={items} activeId={null} sphereGesture={gesture()} />);
    const notCancelled = fireEvent.contextMenu(sphere());
    expect(notCancelled).toBe(false);
  });

  it('without a gesture the sphere is the plain button it was', () => {
    const onSphereClick = vi.fn();
    render(<NavPill items={items} activeId={null} onSphereClick={onSphereClick} />);
    fireEvent.pointerDown(sphere(), { pointerId: 1 });
    act(() => void vi.advanceTimersByTime(HOLD_MS * 2));
    fireEvent.pointerUp(sphere(), { pointerId: 1 });
    fireEvent.click(sphere());
    expect(onSphereClick).toHaveBeenCalledTimes(1);
  });
});
