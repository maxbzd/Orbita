import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { profileRepo } from '../../db';
import { truncate } from '../../domain/text';
import type { Item, Pattern, Profile } from '../../domain/types';
import { Body, Button, Caption, Field, Heading, Label, Pill, Sheet, TextArea, useToast } from '../../ui';
import { MIN_FIELD_CHARS, MIN_NAME_CHARS } from './model';
import styles from './MemorySheet.module.css';
import { tx } from '../../i18n/react';
import { t } from '../../i18n';

export interface MemorySheetProps {
  open: boolean;
  onClose(): void;
  profile: Profile;
  facts: readonly Item[];
  patterns: readonly Pattern[];
}

type FieldKey = 'name' | 'about' | 'goals' | 'values' | 'talkStyle';

const FIELDS: ReadonlyArray<{ key: FieldKey; label: string; hint: string; rows?: number; gain: number }> = [
  { key: 'name', get label() { return t('Name', undefined, 'profile-sheet') }, get hint() { return t('How to address you.') }, gain: 10 },
  { key: 'about', get label() { return t('Who I am') }, get hint() { return t('What you do, who you work with, what your work is.') }, rows: 3, gain: 20 },
  { key: 'goals', get label() { return t('Goals') }, get hint() { return t('Where you are heading over the next year.') }, rows: 3, gain: 15 },
  { key: 'values', get label() { return t('Values') }, get hint() { return t('What matters to you and what you would never do.') }, rows: 2, gain: 10 },
  { key: 'talkStyle', get label() { return t('How to talk to me') }, get hint() { return t('Brief or detailed, gentle or direct.') }, rows: 2, gain: 10 },
];

const pickFields = (profile: Profile): Record<FieldKey, string> => ({
  name: profile.name,
  about: profile.about,
  goals: profile.goals,
  values: profile.values,
  talkStyle: profile.talkStyle,
});

/**
 * «Память» — что ИИ знает: the profile you can edit, the facts and the confirmed patterns.
 * Saving writes to the same profile that "Контекст для ИИ" reads.
 */
export function MemorySheet({ open, onClose, profile, facts, patterns }: MemorySheetProps) {
  const toast = useToast();
  const saved = useMemo(() => pickFields(profile), [profile]);
  const [draft, setDraft] = useState<Record<FieldKey, string>>(saved);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const dirty = FIELDS.some(({ key }) => draft[key] !== saved[key]);

  // Re-read the stored profile each time the sheet opens, so edits made elsewhere show up.
  useEffect(() => {
    if (open) {
      setDraft(saved);
      setJustSaved(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      await profileRepo.save({ name: draft.name.trim(), about: draft.about.trim(), goals: draft.goals.trim(), values: draft.values.trim(), talkStyle: draft.talkStyle.trim() });
      setJustSaved(true);
      toast.show({ message: t('Memory updated.') });
    } catch {
      toast.show({ message: t('Could not save.'), tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };

  const gainOf = (key: FieldKey, gain: number): number => ((key === 'name' ? saved[key].trim().length >= MIN_NAME_CHARS : saved[key].trim().length >= MIN_FIELD_CHARS) ? 0 : gain);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('Memory')}
      description={t('What the AI knows about you. It is stored only on this device.')}
      placement="panel"
      snaps={[0.6, 0.92]}
      defaultSnapIndex={1}
      footer={
        <div className={styles.footer}>
          {justSaved && !dirty ? (
            <Pill tone="ok" dot live>
              {t('Memory updated')}
            </Pill>
          ) : (
            <span />
          )}
          <Button variant="primary" size="md" loading={saving} disabled={!dirty} onClick={() => void save()}>
            {t('Save')}
          </Button>
        </div>
      }
    >
      <div className={styles.body}>
        <section className={styles.group} aria-label={t('Profile')}>
          <Heading as="h3" variant="headline">
            {t('Profile')}
          </Heading>
          {FIELDS.map(({ key, label, hint, rows }) => {
            const gain = gainOf(key, FIELDS.find((field) => field.key === key)?.gain ?? 0);
            const common = {
              label: gain > 0 ? `${label} · +${gain} %` : label,
              hint,
              value: draft[key],
              onChange: (event: { target: { value: string } }) => setDraft((current) => ({ ...current, [key]: event.target.value })),
            };
            return rows ? <TextArea key={key} rows={rows} autoGrow {...common} /> : <Field key={key} autoComplete="name" {...common} />;
          })}
        </section>

        <section className={styles.group} aria-label={t('Facts')}>
          <Heading as="h3" variant="headline">
            {t('Facts')}{' '}<span className={styles.count}>{facts.length}</span>
          </Heading>
          {facts.length === 0 ? (
            <Body tone="muted">{t('No facts yet. They will appear from your records when you say something lasting about yourself or your work, for example “I have 14 users”.')}</Body>
          ) : (
            <ul className={styles.list}>
              {facts.slice(0, 8).map((fact) => (
                <li key={fact.id}>
                  <Link className={styles.rowLink} to={`/items/fact?item=${fact.id}`}>
                    <span className={styles.rowTitle}>{fact.title}</span>
                    {fact.kind === 'fact' && fact.value ? <span className={styles.rowValue}>{fact.value}</span> : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Link className={styles.more} to="/items/fact">
            {t('All facts')}
          </Link>
        </section>

        <section className={styles.group} aria-label={t('Confirmed patterns')}>
          <Heading as="h3" variant="headline">
            {t('Confirmed patterns')}{' '}<span className={styles.count}>{patterns.length}</span>
          </Heading>
          {patterns.length === 0 ? (
            <Body tone="muted">{t('No confirmed patterns yet. They will appear when you answer “yes, that is me” in “Patterns”.')}</Body>
          ) : (
            <ul className={styles.list}>
              {patterns.slice(0, 8).map((pattern) => (
                <li key={pattern.id}>
                  <Link className={styles.rowLink} to="/patterns">
                    <span className={styles.rowTitle}>{pattern.title}</span>
                    <span className={styles.rowValue}>{truncate(pattern.description, 90)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <Label as="p">{t('What leaves your device')}</Label>
        <Caption>
          
          {tx('Nothing is sent on its own. The AI only gets what you include in {link}, at the privacy level you choose.', { link: <Link to="/context">{t('“Context for AI”')}</Link> })}
        
        </Caption>
      </div>
    </Sheet>
  );
}
