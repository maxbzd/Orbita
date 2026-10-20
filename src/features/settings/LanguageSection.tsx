import { useState } from 'react';
import { profileRepo } from '../../db';
import { useProfile, useSettings } from '../../db/hooks';
import type { GlossaryEntry } from '../../domain/types';
import { Body, Button, Chip, Field, IconButton, SegmentedControl } from '../../ui';
import { Group, Row } from './Group';
import { InterfaceLanguage } from './InterfaceLanguage';
import { LANGUAGES, SUGGESTED_TERMS } from './settingsModel';
import { useSaveSettings } from './useSaveSettings';
import styles from './Settings.module.css';
import { t } from '../../i18n';

/** Language and the glossary of the author's niche: both improve the transcript correction and the extraction. */
export function LanguageSection() {
  const settings = useSettings();
  const profile = useProfile();
  const save = useSaveSettings();
  const [term, setTerm] = useState('');
  const [hint, setHint] = useState('');
  if (!settings || !profile) return null;

  const glossary = profile.glossary;
  const has = (value: string): boolean => glossary.some((entry) => entry.term.toLowerCase() === value.trim().toLowerCase());
  // Always read the stored list again: two quick taps must not overwrite each other with a stale copy.
  const change = async (edit: (current: GlossaryEntry[]) => GlossaryEntry[]): Promise<void> => {
    await profileRepo.save({ glossary: edit((await profileRepo.get()).glossary) });
  };
  const add = async (entry: GlossaryEntry): Promise<void> => {
    const term = entry.term.trim();
    if (term === '') return;
    const hintText = entry.hint?.trim();
    await change((current) =>
      current.some((other) => other.term.toLowerCase() === term.toLowerCase()) ? current : [...current, { term, ...(hintText && { hint: hintText }) }],
    );
  };

  return (
    <Group
      id="language"
      title={t('Language and glossary')}
      footer={<p>{t('Terms from your field help recognise speech and fix text: “OKR” will not turn into “okay are”, “sprint” will not become “spring”.')}</p>}
    >
      <Row label={t('Interface language')}>
        <InterfaceLanguage />
      </Row>
      <Row label={t('Recording language')}>
        <SegmentedControl
          aria-label={t('Recording language')}
          options={LANGUAGES.map((language) => ({ value: language.code, label: language.label }))}
          value={LANGUAGES.some((language) => language.code === settings.locale.language) ? settings.locale.language : 'ru'}
          onChange={(code) => void save({ locale: { language: code }, stt: { language: code } })}
          fullWidth
        />
      </Row>

      {glossary.length > 0 ? (
        <ul className={styles.terms} aria-label={t('Glossary terms')}>
          {glossary.map((entry) => (
            <li key={entry.term} className={styles.term}>
              <span className={styles.termText}>
                <Body as="span">{entry.term}</Body>
                {entry.hint ? <span className={styles.termHint}>{entry.hint}</span> : null}
              </span>
              <IconButton icon="close" label={t('Remove the term “{term}”', { term: entry.term })} onClick={() => void change((current) => current.filter((other) => other.term !== entry.term))} />
            </li>
          ))}
        </ul>
      ) : null}

      <form
        className={styles.addTerm}
        onSubmit={(event) => {
          event.preventDefault();
          void add({ term, hint }).then(() => {
            setTerm('');
            setHint('');
          });
        }}
      >
        <Field label={t('New term')} value={term} onChange={(event) => setTerm(event.target.value)} autoComplete="off" placeholder={t('e.g. sprint review')} />
        <Field label={t('Explanation (optional)')} value={hint} onChange={(event) => setHint(event.target.value)} autoComplete="off" placeholder={t('the meeting at the end of a sprint')} />
        <div className={styles.inline}>
          <Button type="submit" size="sm" variant="secondary" disabled={term.trim() === '' || has(term)}>
            {t('Add')}
          </Button>
        </div>
      </form>

      <Row label={t('Common terms')}>
        <div className={styles.chips}>
          {SUGGESTED_TERMS.filter((suggested) => !has(suggested)).map((suggested) => (
            <Chip key={suggested} onClick={() => void add({ term: suggested })}>
              + {suggested}
            </Chip>
          ))}
          {SUGGESTED_TERMS.every(has) ? <Body tone="muted">{t('All common terms are already added.')}</Body> : null}
        </div>
      </Row>
    </Group>
  );
}
