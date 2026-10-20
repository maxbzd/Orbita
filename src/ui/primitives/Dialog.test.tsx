import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog, Dialog } from './Dialog';

describe('Dialog', () => {
  it('is a labelled modal dialog with a description, closed by Escape and by a click outside', () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="Удалить запись?" description="Её можно вернуть в течение 30 дней.">
        <p>Содержимое</p>
      </Dialog>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Удалить запись?' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription('Её можно вернуть в течение 30 дней.');

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.mouseDown(dialog.parentElement!);
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.mouseDown(dialog); // a click inside does not close
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('does not close when it is not dismissible', () => {
    const onClose = vi.fn();
    render(<Dialog open onClose={onClose} title="Важно" dismissible>x</Dialog>);
    render(<Dialog open onClose={onClose} title="Нельзя" dismissible={false}>y</Dialog>);
    // the topmost layer is the second one
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps Escape for the topmost layer only', () => {
    const lower = vi.fn();
    const upper = vi.fn();
    render(<Dialog open onClose={lower} title="Нижний">x</Dialog>);
    render(<Dialog open onClose={upper} title="Верхний">y</Dialog>);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(upper).toHaveBeenCalledTimes(1);
    expect(lower).not.toHaveBeenCalled();
  });

  it('renders nothing when closed', () => {
    render(<Dialog open={false} onClose={() => undefined} title="Скрыт">x</Dialog>);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('ConfirmDialog', () => {
  it('announces as an alertdialog, starts on the safe choice and confirms or cancels', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmDialog open title="Удалить?" message="Это нельзя отменить." confirmLabel="Удалить" danger onConfirm={onConfirm} onCancel={onCancel} />);
    expect(screen.getByRole('alertdialog', { name: 'Удалить?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Отмена' })).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
