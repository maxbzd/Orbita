import { useState } from 'react';
import { msg, t } from '../../i18n';
import { Button, Dialog, Field } from '../../ui';

/** The word that confirms an irreversible deletion (Tolan's pattern: typing it makes the user stop and read). */
export const CONFIRM_WORD = msg('delete');

export const isConfirmWord = (typed: string, word: string = t(CONFIRM_WORD)): boolean => typed.trim().toLowerCase() === word;

export interface TypedConfirmProps {
  open: boolean;
  onClose(): void;
  title: string;
  description: string;
  confirmLabel: string;
  /** Runs after the word is typed and the button pressed. */
  onConfirm(): void | Promise<void>;
  word?: string;
}

/** A dialog whose red button works only after the user types the word “delete”. */
export function TypedConfirm({ open, onClose, title, description, confirmLabel, onConfirm, word = t(CONFIRM_WORD) }: TypedConfirmProps) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const close = (): void => {
    setTyped('');
    onClose();
  };
  return (
    <Dialog
      open={open}
      onClose={close}
      title={title}
      description={description}
      role="alertdialog"
      size="sm"
      actions={
        <>
          <Button variant="ghost" size="sm" onClick={close} data-autofocus="">
            {t('Cancel', undefined, 'typed-confirm')}
          </Button>
          <Button
            variant="danger"
            size="sm"
            loading={busy}
            disabled={!isConfirmWord(typed, word)}
            onClick={() => {
              setBusy(true);
              void Promise.resolve(onConfirm()).finally(() => {
                setBusy(false);
                setTyped('');
              });
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <Field label={t('To confirm, type “{word}”', { word })} value={typed} onChange={(event) => setTyped(event.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} />
    </Dialog>
  );
}
