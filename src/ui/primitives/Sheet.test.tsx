import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installMatchMedia } from '../../styles/mockMatchMedia';
import type { MatchMediaControl } from '../../styles/mockMatchMedia';
import { Sheet } from './Sheet';

let media: MatchMediaControl;
beforeEach(() => {
  media = installMatchMedia({ width: 390 });
});
afterEach(() => media.restore());

function Harness({ onClose = () => undefined, dismissible = true }: { onClose?(): void; dismissible?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Открыть</button>
      <Sheet
        open={open}
        title="Фильтры"
        dismissible={dismissible}
        onClose={() => {
          onClose();
          setOpen(false);
        }}
      >
        <button>Первая</button>
        <button>Последняя</button>
      </Sheet>
    </>
  );
}

describe('Sheet', () => {
  it('renders nothing while closed and a labelled modal dialog when open', () => {
    const { rerender } = render(<Sheet open={false} onClose={() => undefined} title="Фильтры">x</Sheet>);
    expect(screen.queryByRole('dialog')).toBeNull();
    rerender(<Sheet open onClose={() => undefined} title="Фильтры">x</Sheet>);
    const dialog = screen.getByRole('dialog', { name: 'Фильтры' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('data-mode', 'sheet');
  });

  it('opens at the middle stop by default and honours defaultSnapIndex', () => {
    const { rerender } = render(<Sheet open onClose={() => undefined} title="A">x</Sheet>);
    expect(screen.getByRole('dialog')).toHaveAttribute('data-snap', '1');
    rerender(<Sheet open onClose={() => undefined} title="A" defaultSnapIndex={0}>x</Sheet>);
    // the stop only resets on (re)opening: unmount and open again
    rerender(<Sheet open={false} onClose={() => undefined} title="A">x</Sheet>);
    rerender(<Sheet open onClose={() => undefined} title="A" defaultSnapIndex={2}>x</Sheet>);
    expect(screen.getByRole('dialog')).toHaveAttribute('data-snap', '2');
  });

  it('moves between the stops with the arrow keys on the grabber and reports the change', () => {
    const onSnapChange = vi.fn();
    render(<Sheet open onClose={() => undefined} title="A" onSnapChange={onSnapChange}>x</Sheet>);
    const grabber = screen.getByRole('button', { name: /Высота листа: 70 %/ });
    fireEvent.keyDown(grabber, { key: 'ArrowUp' });
    expect(screen.getByRole('dialog')).toHaveAttribute('data-snap', '2');
    expect(onSnapChange).toHaveBeenLastCalledWith(2);
    fireEvent.keyDown(grabber, { key: 'ArrowDown' });
    fireEvent.keyDown(grabber, { key: 'ArrowDown' });
    expect(screen.getByRole('dialog')).toHaveAttribute('data-snap', '0');
    fireEvent.keyDown(grabber, { key: 'ArrowDown' }); // already at the lowest: stays
    expect(screen.getByRole('dialog')).toHaveAttribute('data-snap', '0');
  });

  it('a tap on the grabber steps up and wraps from the top stop to the lowest', () => {
    render(<Sheet open onClose={() => undefined} title="A">x</Sheet>);
    const grabber = screen.getByRole('button', { name: /Высота листа/ });
    fireEvent.click(grabber);
    expect(screen.getByRole('dialog')).toHaveAttribute('data-snap', '2');
    fireEvent.click(grabber);
    expect(screen.getByRole('dialog')).toHaveAttribute('data-snap', '0');
  });

  it('works as a controlled sheet', () => {
    const { rerender } = render(<Sheet open onClose={() => undefined} title="A" snapIndex={0}>x</Sheet>);
    expect(screen.getByRole('dialog')).toHaveAttribute('data-snap', '0');
    rerender(<Sheet open onClose={() => undefined} title="A" snapIndex={2}>x</Sheet>);
    expect(screen.getByRole('dialog')).toHaveAttribute('data-snap', '2');
  });

  it('closes on Escape, on the scrim and on the close button', () => {
    const onClose = vi.fn();
    render(<Sheet open onClose={onClose} title="A">x</Sheet>);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('scrim'));
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('ignores Escape and the scrim when it is not dismissible', () => {
    const onClose = vi.fn();
    render(<Sheet open onClose={onClose} title="A" dismissible={false}>x</Sheet>);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    fireEvent.click(screen.getByTestId('scrim'));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Закрыть' })).toBeNull();
  });

  it('moves focus inside on open, traps Tab, and gives focus back to the opener on close', async () => {
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Открыть' });
    opener.focus();
    fireEvent.click(opener);

    const dialog = await screen.findByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);

    const last = screen.getByRole('button', { name: 'Последняя' });
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Высота листа/ })); // wrapped to the first control

    fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last); // and back from the first to the last

    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await waitFor(() => expect(opener).toHaveFocus());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('makes the page inert while open and restores it', async () => {
    const root = document.createElement('div');
    root.id = 'root';
    document.body.appendChild(root);
    const { rerender } = render(<Sheet open onClose={() => undefined} title="A">x</Sheet>);
    expect(root).toHaveAttribute('inert');
    expect(document.documentElement).toHaveAttribute('data-overlay');
    rerender(<Sheet open={false} onClose={() => undefined} title="A">x</Sheet>);
    expect(root).not.toHaveAttribute('inert');
    expect(document.documentElement).not.toHaveAttribute('data-overlay');
    root.remove();
  });

  it('becomes a centred window (no stops) on a wide screen, and a right panel on request', () => {
    media.setWidth(1440);
    const { rerender } = render(<Sheet open onClose={() => undefined} title="A">x</Sheet>);
    expect(screen.getByRole('dialog')).toHaveAttribute('data-mode', 'modal');
    expect(screen.queryByRole('button', { name: /Высота листа/ })).toBeNull();
    rerender(<Sheet open onClose={() => undefined} title="A" placement="panel">x</Sheet>);
    expect(screen.getByRole('dialog')).toHaveAttribute('data-mode', 'panel');
    rerender(<Sheet open onClose={() => undefined} title="A" placement="sheet">x</Sheet>);
    expect(screen.getByRole('dialog')).toHaveAttribute('data-mode', 'sheet');
  });

  it('drags: a long pull down from the lowest stop closes it, a short one does not', () => {
    const onClose = vi.fn();
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    render(<Sheet open onClose={onClose} title="A" snapIndex={0}>x</Sheet>);
    const head = screen.getByRole('dialog').querySelector('header')!;
    const pointer = (type: string, y: number, t: number) => {
      const event = new MouseEvent(type, { bubbles: true, clientY: y, button: 0 });
      Object.defineProperty(event, 'pointerId', { value: 1 });
      Object.defineProperty(event, 'timeStamp', { value: t });
      fireEvent(head, event);
    };

    pointer('pointerdown', 100, 0);
    pointer('pointermove', 130, 100);
    pointer('pointerup', 130, 110);
    expect(onClose).not.toHaveBeenCalled();

    pointer('pointerdown', 100, 1000);
    pointer('pointermove', 300, 1400);
    pointer('pointermove', 400, 1800);
    pointer('pointerup', 400, 1810);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
