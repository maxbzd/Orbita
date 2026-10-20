import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatClock, formatDayShort, formatTime, localDayKey } from '../../../domain/dates';
import { recoveryService, selectIsRecording, useRecorder, useRecovery } from '../../../state';
import { Body, Button, Dialog, useToast } from '../../../ui/primitives';
import { t } from '../../../i18n';

/**
 * «Найдена незавершённая запись»: shown once per launch when a recording was cut short (a killed tab, a dead
 * battery). Its pieces are in IndexedDB; "Восстановить" glues them and sends the capture to processing.
 */
export function RecoveryPrompt() {
  const { items, busy, error } = useRecovery();
  const recording = useRecorder(selectIsRecording);
  const navigate = useNavigate();
  const toast = useToast();

  useEffect(() => {
    void recoveryService.check();
    // A quick reload can look at the chunks while the dying page still holds its recording lock: look once more.
    const retry = window.setTimeout(() => {
      if (recoveryService.store.getState().items.length === 0) void recoveryService.check({ force: true });
    }, 4000);
    return () => window.clearTimeout(retry);
  }, []);

  const lost = items[0];
  const open = lost !== undefined && !recording;
  if (!lost) return null;

  const when = lost.capture?.createdAt ?? lost.lastChunkAt;
  const more = items.length - 1;

  const restore = async (): Promise<void> => {
    const id = await recoveryService.restore(lost.captureId);
    if (id) {
      toast.show({
        message: t('The recording is restored. Processing.'),
        actionLabel: t('Open', undefined, 'recovery-prompt'),
        onAction: () => navigate(`/review/${id}`),
      });
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => recoveryService.postpone()}
      title={t('An unfinished recording was found')}
      role="alertdialog"
      description={t('A recording from {formatDayShort}, {formatTime}, about {formatClock}. The app closed during recording, but what was said is saved.', { formatDayShort: formatDayShort(localDayKey(when)), formatTime: formatTime(when), formatClock: formatClock(lost.durationSec) })}
      actions={
        <>
          <Button variant="ghost" onClick={() => recoveryService.postpone()}>
            {t('Not now')}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => void recoveryService.discard(lost.captureId)}>
            {t('Delete')}
          </Button>
          <Button variant="primary" size="md" loading={busy} data-autofocus="" onClick={() => void restore()}>
            {t('Restore', undefined, 'recovery-prompt')}
          </Button>
        </>
      }
    >
      {more > 0 ? <Body tone="muted">{t('And {more} more after this one.', { more })}</Body> : null}
      {error ? (
        <Body role="alert" style={{ color: 'var(--danger)' }}>
          {error}
        </Body>
      ) : null}
    </Dialog>
  );
}
