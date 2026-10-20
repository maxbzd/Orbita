import { Body, Button, Caption, Mono } from '../../ui';
import { Group, Row } from './Group';
import { installHint } from './about';
import styles from './Settings.module.css';
import { t } from '../../i18n';

/** Kept equal to `version` in package.json (a test checks it). */
export const APP_VERSION = '0.1.0';

export function AboutSection() {
  const hint = installHint(typeof navigator === 'undefined' ? '' : navigator.userAgent, isStandalone());
  return (
    <Group id="about" title={t('About')}>
      <Row label={t('Orbita')}>
        <Caption>
          {t('Version')}{' '}<Mono>{APP_VERSION}</Mono>
        </Caption>
        <Body tone="muted">{t('A personal system for making sense of life and work. Works offline, data is stored on this device.')}</Body>
      </Row>
      <div className={styles.about}>
        <Body as="p">{hint.title}</Body>
        <ol>
          {hint.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        {hint.note ? <Caption tone="faint">{hint.note}</Caption> : null}
      </div>
      <Row label={t('Updates')} hint={t('A new version is picked up the next time you start the app.')}>
        <div className={styles.inline}>
          <Button size="sm" variant="ghost" onClick={() => window.location.reload()}>
            {t('Restart')}
          </Button>
        </div>
      </Row>
    </Group>
  );
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches);
}
