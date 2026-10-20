import { SegmentedControl } from '../../ui';
import { changeLocalePref, getLocalePref, t, useLocale } from '../../i18n';
import type { LocalePref } from '../../i18n';

/** English, Russian or "follow the browser". The choice is stored on the device and applied at once. */
export function InterfaceLanguage({ size }: { size?: 'sm' | 'md' }) {
  useLocale();
  const options: ReadonlyArray<{ value: LocalePref; label: string }> = [
    { value: 'auto', label: t('Auto') },
    { value: 'en', label: 'English' },
    { value: 'ru', label: 'Русский' },
  ];
  return (
    <SegmentedControl<LocalePref>
      aria-label={t('Interface language')}
      options={options}
      value={getLocalePref()}
      onChange={(pref) => void changeLocalePref(pref)}
      {...(size && { size })}
      fullWidth
    />
  );
}
