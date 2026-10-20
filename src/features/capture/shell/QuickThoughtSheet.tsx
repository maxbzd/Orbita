import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { recorderService } from '../../../state';
import { Button, Sheet, TextArea, useToast } from '../../../ui/primitives';
import { useQuickActions } from './quickActions';
import styles from './shell.module.css';
import { t } from '../../../i18n';

const MAX_CHARS = 2000;

/** «Быстрая мысль»: one line, no microphone. The text is saved at once and processed in the background. */
export function QuickThoughtSheet() {
  const open = useQuickActions((state) => state.sheet === 'quick');
  const close = useQuickActions((state) => state.close);
  const navigate = useNavigate();
  const toast = useToast();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setText('');
      setError(null);
    }
  }, [open]);

  const save = async (): Promise<void> => {
    const clean = text.trim();
    if (clean === '' || busy) return;
    setBusy(true);
    try {
      const id = await recorderService.saveText(clean);
      close();
      toast.show({
        message: t('Recorded. I will process it in the background.'),
        actionLabel: t('Open', undefined, 'quick-thought-sheet'),
        onAction: () => navigate(`/review/${id}`),
      });
    } catch {
      setError(t('Could not save. The text stayed in the field: try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={close}
      title={t('Quick thought')}
      placement="auto"
      snaps={[0.6, 0.9]}
      defaultSnapIndex={0}
      footer={
        <Button variant="primary" fullWidth loading={busy} disabled={text.trim() === ''} iconStart="check" onClick={() => void save()}>
          {t('Save')}
        </Button>
      }
    >
      <div className={styles.stack}>
        <TextArea
          data-autofocus=""
          aria-label={t('Text of the thought')}
          placeholder={t('What is on your mind?')}
          value={text}
          maxLength={MAX_CHARS}
          autoGrow
          maxRows={6}
          rows={3}
          error={error ?? undefined}
          onChange={(event) => {
            setText(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void save();
            }
          }}
        />
        <p className={styles.fine}>{t('Ctrl + Enter saves. The AI can make mistakes. Check.')}</p>
      </div>
    </Sheet>
  );
}
