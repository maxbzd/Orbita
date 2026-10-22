import { changeLocalePref, getLocalePref, LOCALES, t, useLocale } from '../../i18n';
import type { LocalePref } from '../../i18n';
import styles from './InterfaceLanguage.module.css';

/** Any supported language or "follow the browser". The choice is stored on the device and applied at once. */
export function InterfaceLanguage({ size }: { size?: 'sm' | 'md' }) {
  useLocale();
  return (
    <select
      className={size === 'sm' ? `${styles.select} ${styles.sm}` : styles.select}
      aria-label={t('Interface language')}
      value={getLocalePref()}
      onChange={(event) => void changeLocalePref(event.target.value as LocalePref)}
    >
      <option value="auto">{t('Auto')}</option>
      {LOCALES.map((locale) => (
        <option key={locale.id} value={locale.id}>
          {locale.native}
        </option>
      ))}
    </select>
  );
}
