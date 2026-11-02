import { Body, Button, Caption, Display, Icon, Label } from '../../ui';
import type { IconName } from '../../ui';
import styles from './Onboarding.module.css';
import { t } from '../../i18n';

/** The three taps that move the app out of Safari's reach, numbered, each with the icon of what to tap. */
export function InstallSteps({ className }: { className?: string }) {
  const steps: Array<{ icon: IconName; text: string }> = [
    { icon: 'share', text: t('Tap “Share” (the square with an arrow).') },
    { icon: 'plus', text: t('Choose “Add to Home Screen” and tap “Add”.') },
    { icon: 'check', text: t('Open Orbita from the new icon and set it up there. The Home Screen app has its own storage.') },
  ];
  return (
    <ol className={className ?? styles.installSteps}>
      {steps.map((step, index) => (
        <li key={step.icon}>
          <span className={styles.installIcon} aria-hidden="true">
            <Icon name={step.icon} size={20} />
          </span>
          <span>
            <b>{index + 1}.</b> {step.text}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Onboarding, iPhone in a Safari tab: install first, because Safari may delete a tab's data after 7 idle days.
 * Anything typed in the tab would not move to the installed app, which has its own storage.
 */
export default function SafetyStep({ onContinue }: { onContinue: () => void }) {
  return (
    <div className={styles.step}>
      <div className={styles.safetyHead}>
        <Label className={styles.safetyLabel}>
          <Icon name="alert" size={14} /> {t('Before we start')}
        </Label>
        <Display as="h1" size="l" className={styles.headline}>
          {t('Add Orbita to your Home Screen')}
        </Display>
        <Body tone="muted">{t('Safari deletes the data of websites you have not opened for 7 days. Orbita keeps everything on this phone, so your records could disappear. An app on the Home Screen is exempt.')}</Body>
      </div>
      <InstallSteps />
      <Caption>{t('Also keep an encrypted backup (Settings, Data) and store the file in iCloud Drive.')}</Caption>
      <div className={styles.actions}>
        <Button variant="ghost" onClick={onContinue}>
          {t('Continue without installing')}
        </Button>
      </div>
    </div>
  );
}
