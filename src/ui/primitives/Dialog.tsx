import { useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { useReducedMotion } from '../../styles/theme';
import { Button } from './Button';
import { Portal } from './Portal';
import { Scrim } from './Scrim';
import { useModalBehavior } from './overlay';
import { usePresence } from './usePresence';
import { cx } from './cx';
import styles from './Dialog.module.css';
import { t } from '../../i18n';

export interface DialogProps {
  open: boolean;
  onClose(): void;
  /** Accessible name; visible as the heading unless `hideTitle`. */
  title: string;
  hideTitle?: boolean;
  description?: ReactNode;
  /** The buttons row. Put the safe choice first in the DOM only if it is also the default. */
  actions?: ReactNode;
  /** `alertdialog` for confirmations that interrupt (the screen reader announces it at once). */
  role?: 'dialog' | 'alertdialog';
  /** `top` sits near the top edge (the command palette); `center` is the default. */
  placement?: 'center' | 'top';
  size?: 'sm' | 'md' | 'lg';
  /** Esc and the scrim close the dialog. Default true. */
  dismissible?: boolean;
  /** Content without padding or a header (the command palette draws its own). */
  bare?: boolean;
  className?: string;
  children?: ReactNode;
}

/** A modal dialog: rare by design (sheets are preferred). Focus is trapped, Esc closes it. */
export function Dialog({
  open,
  onClose,
  title,
  hideTitle,
  description,
  actions,
  role = 'dialog',
  placement = 'center',
  size = 'md',
  dismissible = true,
  bare,
  className,
  children,
}: DialogProps) {
  const reduced = useReducedMotion();
  const { mounted, shown } = usePresence(open, reduced ? 120 : 240);
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useModalBehavior({
    active: open,
    containerRef: ref,
    onEscape: () => {
      if (dismissible) onClose();
    },
    // The least destructive control first: an explicit [data-autofocus], else the first focusable.
    initialFocus: (container) => container.querySelector<HTMLElement>('[data-autofocus]'),
  });

  if (!mounted) return null;

  return (
    <Portal>
      <Scrim shown={shown} onClick={dismissible ? onClose : undefined} />
      <div className={cx(styles.wrap, styles[placement])} onMouseDown={(e) => e.target === e.currentTarget && dismissible && onClose()}>
        <div
          ref={ref}
          className={cx(styles.dialog, styles[size], shown && styles.shown, bare && styles.bare, className)}
          role={role}
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={description ? descriptionId : undefined}
        >
          <h2 id={titleId} className={cx(styles.title, (hideTitle || bare) && 'sr-only')}>
            {title}
          </h2>
          {description ? (
            <p id={descriptionId} className={styles.description}>
              {description}
            </p>
          ) : null}
          {children}
          {actions ? <div className={styles.actions}>{actions}</div> : null}
        </div>
      </div>
    </Portal>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Destructive confirmation: a red button; focus starts on "Отмена". */
  danger?: boolean;
  onConfirm(): void;
  onCancel(): void;
}

/** "Удалить запись?" - the one shape most dialogs take. */
export function ConfirmDialog({ open, title, message, confirmLabel = t('Confirm'), cancelLabel = t('Cancel', undefined, 'dialog'), danger, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      description={message}
      role="alertdialog"
      size="sm"
      actions={
        <>
          <Button variant="ghost" size="sm" onClick={onCancel} data-autofocus="">
            {cancelLabel}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} size="sm" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}
