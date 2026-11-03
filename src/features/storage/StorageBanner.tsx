import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { dismissNotice, refreshEstimate, resolveFull, storageLevel, useStorageHealth } from '../../lib/storageHealth';
import { deleteRecordings, findOldRecordings } from '../../db/audioSpace';
import type { ReclaimableAudio } from '../../db/audioSpace';
import { Body, Button, Dialog, IconButton, Icon, useToast } from '../../ui';
import styles from './StorageBanner.module.css';
import { t } from '../../i18n';

const mb = (bytes: number): string => `${Math.max(1, Math.round(bytes / 1_048_576))} MB`;

/**
 * Tells the person, at once and plainly, when the device has no room left for their data: a change that was refused is NOT
 * saved, and silence there would turn into a missing record weeks later. Before that, a softer notice from 90 % of the
 * browser's allowance. Both offer the two things that help: a backup, and giving up the sound of old records whose text is
 * already saved (asked first, with the number and the size).
 */
export function StorageBanner() {
  const health = useStorageHealth();
  const level = storageLevel(health);
  const toast = useToast();
  const navigate = useNavigate();
  const [offer, setOffer] = useState<ReclaimableAudio | null>(null);

  // look at the room now, and again whenever the app comes back to the front
  useEffect(() => {
    void refreshEstimate();
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void refreshEstimate();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  const review = async (): Promise<void> => {
    try {
      const found = await findOldRecordings();
      if (found.captureIds.length === 0) toast.show({ message: t('No old recordings to delete'), duration: 4000 });
      else setOffer(found);
    } catch {
      toast.show({ message: t("Couldn't free space"), tone: 'danger', duration: 4000 });
    }
  };

  const confirm = async (): Promise<void> => {
    if (!offer) return;
    try {
      const removed = await deleteRecordings(offer.captureIds);
      await refreshEstimate();
      resolveFull();
      toast.show({ message: t('Recordings deleted: {n}', { n: removed }), tone: 'ok', duration: 4000 });
    } catch {
      toast.show({ message: t("Couldn't free space"), tone: 'danger', duration: 4000 });
    } finally {
      setOffer(null);
    }
  };

  if (level === 'ok' || (health.dismissed && level !== 'full')) return offer ? dialog() : null;
  const full = level === 'full';

  function dialog() {
    return (
      <Dialog
        open
        onClose={() => setOffer(null)}
        title={t('Delete old recordings')}
        size="sm"
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={() => setOffer(null)} data-autofocus="">
              {t('Cancel', undefined, 'confirm-sheet')}
            </Button>
            <Button variant="danger" size="sm" onClick={() => void confirm()}>
              {t('Delete recordings')}
            </Button>
          </>
        }
      >
        <Body tone="muted">{t('Recordings older than 30 days: {n} ({size}). Delete them? Their texts stay; the sound is removed from this device.', { n: offer?.captureIds.length ?? 0, size: mb(offer?.bytes ?? 0) })}</Body>
      </Dialog>
    );
  }

  return (
    <>
      <div className={styles.banner}>
        <aside className={`${styles.card} ${full ? styles.full : ''}`} role={full ? 'alert' : 'status'}>
          <span className={styles.badge} aria-hidden="true">
            <Icon name="alert" size={18} />
          </span>
          <div className={styles.body}>
            <p className={styles.title}>{full ? t('Storage is full') : t('Storage is almost full')}</p>
            <p className={styles.text}>
              {full
                ? t('The last change was not saved. Nothing saved earlier is lost. Make a backup, free some space and try again.')
                : t('Orbita is close to the space your browser allows. Make a backup and free some space before it runs out.')}
            </p>
            <div className={styles.actions}>
              <Button size="sm" variant="primary" onClick={() => navigate('/settings?section=data')}>
                {t('Make a backup')}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => void review()}>
                {t('Delete old recordings')}
              </Button>
            </div>
          </div>
          <IconButton icon="close" label={t('Close')} variant="ghost" onClick={dismissNotice} />
        </aside>
      </div>
      {offer ? dialog() : null}
    </>
  );
}
