import { Icon } from '../../ui/icons';
import { Body, Button, Display } from '../../ui/primitives';
import styles from './CaptureScreen.module.css';
import { t, msg } from '../../i18n';

export interface MicDeniedProps {
  /** Ready Russian sentence from the audio layer. */
  message: string;
  /** `denied` has its own instructions; the other codes just show the message. */
  code: string;
  onType(): void;
  onRetry(): void;
  onBack(): void;
}

const STEPS_DENIED = [
  msg('Tap the lock icon next to the site address.'),
  msg('Find “Microphone” and choose “Allow”.'),
  msg('Come back here and tap “Try again”.'),
];

/**
 * The microphone is refused or missing. The way out is one tap away: the same screen as text. Nothing the user
 * says is lost because the microphone is off; they just type it.
 */
export function MicDenied({ message, code, onType, onRetry, onBack }: MicDeniedProps) {
  return (
    <section className={styles.denied} aria-labelledby="mic-denied-title" data-testid="mic-denied">
      <span className={styles.deniedIcon} aria-hidden="true">
        <Icon name="mic" size={32} />
      </span>
      <Display as="h2" size="l" id="mic-denied-title">
        {t('Microphone unavailable')}
      </Display>
      <Body tone="muted" role="alert">
        {message}
      </Body>
      {code === 'denied' ? (
        <ol className={styles.steps}>
          {STEPS_DENIED.map((step) => (
            <li key={step}>{t(step)}</li>
          ))}
        </ol>
      ) : null}
      <div className={styles.deniedActions}>
        <Button variant="primary" iconStart="text" onClick={onType}>
          {t('Write instead')}
        </Button>
        <Button variant="secondary" onClick={onRetry}>
          {t('Try again', undefined, 'mic-denied')}
        </Button>
        <Button variant="ghost" onClick={onBack}>
          {t('Back')}
        </Button>
      </div>
    </section>
  );
}
