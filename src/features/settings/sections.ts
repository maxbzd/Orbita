import { t } from '../../i18n';
/** The groups in order; `?section=<id>` (from other screens) scrolls to one. */
export const SECTIONS = [
  { id: 'ai', get label() { return t('AI') } },
  { id: 'speech', get label() { return t('Speech') } },
  { id: 'language', get label() { return t('Language') } },
  { id: 'look', get label() { return t('Look') } },
  { id: 'capture', get label() { return t('Capture') } },
  { id: 'privacy', get label() { return t('Privacy') } },
  { id: 'lock', get label() { return t('Lock') } },
  { id: 'cloud', get label() { return t('Cloud') } },
  { id: 'data', get label() { return t('Data') } },
  { id: 'about', get label() { return t('About') } },
] as const;

export type SectionId = (typeof SECTIONS)[number]['id'];
