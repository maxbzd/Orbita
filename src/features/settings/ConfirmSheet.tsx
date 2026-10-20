import { useState } from 'react';
import { Body, Button, Dialog } from '../../ui';
import { t } from '../../i18n';

export interface ConfirmSheetProps {
  open: boolean;
  onClose(): void;
  title: string;
  message: string;
  confirmLabel: string;
  disabled?: boolean;
  onConfirm(): void | Promise<void>;
}

/** A plain «Да / Отмена» dialog that stays open while its action runs, and closes after it. */
export function ConfirmSheet({ open, onClose, title, message, confirmLabel, disabled, onConfirm }: ConfirmSheetProps) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onClose={busy ? () => undefined : onClose}
      title={title}
      role="alertdialog"
      size="sm"
      actions={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy} data-autofocus="">
            {t('Cancel', undefined, 'confirm-sheet')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            loading={busy}
            disabled={disabled}
            onClick={() => {
              setBusy(true);
              void Promise.resolve(onConfirm()).finally(() => {
                setBusy(false);
                onClose();
              });
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <Body tone="muted">{message}</Body>
    </Dialog>
  );
}
