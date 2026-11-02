import { useState } from 'react';
import { Link } from 'react-router';
import { Button, Caption, Icon, IconButton } from '../../ui';
import { InstallSteps } from '../onboarding/SafetyStep';
import { snoozeInstallNudge } from '../../lib/storageRisk';
import styles from './Today.module.css';
import { t } from '../../i18n';

/** On the day screen of an iPhone in a Safari tab: the browser may delete everything after a week without use. */
export default function InstallReminder({ onSnooze }: { onSnooze: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <aside className={styles.install} aria-label={t('Safari may delete your data')}>
      <div className={styles.installRow}>
        <span className={styles.installBadge} aria-hidden="true">
          <Icon name="alert" size={18} />
        </span>
        <p className={styles.installText}>
          <b>{t('Safari may delete your data')}</b> {t('Add Orbita to your Home Screen so your records stay safe.')}
        </p>
        <Button variant="secondary" size="sm" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          {t('How')}
        </Button>
        <IconButton
          icon="close"
          label={t('Remind me later')}
          variant="ghost"
          onClick={() => {
            snoozeInstallNudge();
            onSnooze();
          }}
        />
      </div>
      {open ? (
        <>
          <InstallSteps />
          <Caption>
            {t('Also keep an encrypted backup (Settings, Data) and store the file in iCloud Drive.')}{' '}
            <Link to="/settings">{t('Open settings')}</Link>
          </Caption>
        </>
      ) : null}
    </aside>
  );
}
