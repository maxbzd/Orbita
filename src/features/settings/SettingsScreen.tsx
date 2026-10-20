import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Body, Chip, Display } from '../../ui';
import { AboutSection } from './AboutSection';
import { AiSection } from './AiSection';
import { AppearanceSection } from './AppearanceSection';
import { syncEnabled } from '../../sync/config';
import { CloudSection } from './CloudSection';
import { CaptureSection } from './CaptureSection';
import { DataSection } from './DataSection';
import { LanguageSection } from './LanguageSection';
import { LockSection } from './LockSection';
import { SpeechSection } from './SpeechSection';
import { SECTIONS } from './sections';
import styles from './Settings.module.css';
import { t } from '../../i18n';

function jump(id: string): void {
  const target = document.getElementById(`section-${id}`);
  target?.scrollIntoView({ behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
}

export default function SettingsScreen() {
  const [params] = useSearchParams();
  const section = params.get('section');

  useEffect(() => {
    if (!section) return undefined;
    const timer = window.setTimeout(() => jump(section), 120);
    return () => window.clearTimeout(timer);
  }, [section]);

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <Display as="h1" size="l" className={styles.title}>
          {t('Settings')}
        </Display>
        <Body tone="muted" className={styles.lead}>
          {t('Data is stored on this device, and with the cloud, on your other devices too. Here you decide what the app can do and what may leave.')}
        </Body>
      </header>
      <nav className={styles.jump} aria-label={t('Settings sections')}>
        {SECTIONS.filter((entry) => entry.id !== 'cloud' || syncEnabled()).map((entry) => (
          <Chip key={entry.id} onClick={() => jump(entry.id)}>
            {entry.label}
          </Chip>
        ))}
      </nav>
      <AiSection />
      <SpeechSection />
      <LanguageSection />
      <AppearanceSection />
      <CaptureSection />
      <LockSection />
      {syncEnabled() ? <CloudSection /> : null}
      <DataSection />
      <AboutSection />
    </div>
  );
}
