import { useSettings } from '../../db/hooks';
import type { EffectsMode, ThemeMode } from '../../domain/types';
import { EFFECTS_LABELS, THEME_LABELS, themeFromSettings, themeToSettings, useEffectsTier, useMotionPreference, useTheme } from '../../styles';
import type { ThemePreference } from '../../styles';
import { SegmentedControl, Toggle } from '../../ui';
import { Group, Row } from './Group';
import { useSaveSettings } from './useSaveSettings';
import { t } from '../../i18n';

const THEME_OPTIONS = (['night', 'dawn', 'auto'] as const).map((value) => ({ value, label: value === 'auto' ? t('Auto') : THEME_LABELS[value] }));
const EFFECT_OPTIONS = (['auto', 'max', 'reduced', 'min'] as const).map((value) => ({ value, label: EFFECTS_LABELS[value] }));

const TIER_TEXT = { get high() { return t('high', undefined, 'quality') }, get mid() { return t('medium', undefined, 'quality') }, get low() { return t('basic', undefined, 'quality') } } as const;

export function AppearanceSection() {
  const settings = useSettings();
  const save = useSaveSettings();
  const { setTheme } = useTheme();
  const { tier, setPreference } = useEffectsTier();
  const { systemReduced, setReduceMotion } = useMotionPreference();
  if (!settings) return null;

  const theme: ThemeMode = settings.theme;
  return (
    <Group id="look" title={t('Look')}>
      <Row label={t('Theme')}>
        <SegmentedControl<ThemePreference>
          aria-label={t('Theme')}
          options={THEME_OPTIONS}
          value={themeFromSettings(theme)}
          onChange={(value) => {
            setTheme(value);
            void save({ theme: themeToSettings(value) });
          }}
          fullWidth
        />
      </Row>
      <Row
        label={t('Effects')}
        hint={t('Glow, blur and background animation. Your device is currently rated: {v} quality. On a weak phone “Minimum” saves battery.', { v: TIER_TEXT[tier] })}
      >
        <SegmentedControl<EffectsMode>
          aria-label={t('Effects')}
          options={EFFECT_OPTIONS}
          value={settings.ui.effects}
          onChange={(value) => {
            setPreference(value);
            void save({ ui: { effects: value } });
          }}
          fullWidth
        />
      </Row>
      <Toggle
        label={t('Reduce motion')}
        description={systemReduced ? t('Already on in your system settings. Here you can turn on the same just for Orbita.') : t('Turns off floating animations: the sphere and background stay calm.')}
        checked={settings.ui.reduceMotion}
        onChange={(checked) => {
          setReduceMotion(checked);
          void save({ ui: { reduceMotion: checked } });
        }}
      />
    </Group>
  );
}
