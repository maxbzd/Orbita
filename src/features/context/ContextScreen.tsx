import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { BUILTIN_PRESETS, CONTEXT_SECTIONS, CONTEXT_SECTION_TITLES, buildContextPack, presetForPerson } from '../../ai';
import type { ContextPack } from '../../ai';
import { presetsRepo } from '../../db';
import { usePeople, usePerson, usePresets, useProfile, useProjects, useSettings } from '../../db/hooks';
import type { PrivacyLevel } from '../../domain/types';
import { PRIVACY_LEVELS } from '../../domain/types';
import {
  Body,
  Button,
  Caption,
  Chip,
  Display,
  Field,
  Heading,
  Icon,
  IconButton,
  Label,
  Mono,
  SegmentedControl,
  Sheet,
  useToast,
} from '../../ui';
import { downloadText } from '../settings/dataActions';
import { PRIVACY_HINTS, PRIVACY_LABELS } from '../settings/settingsModel';
import { copyText } from './clipboard';
import {
  BUDGET_CHOICES,
  WINDOW_CHOICES,
  budgetState,
  defaultDraft,
  draftFromPreset,
  draftToOptions,
  formatCount,
  packFileName,
  personFromSearch,
  presetChips,
  presetFromDraft,
  toggleId,
  toggleSection,
} from './model';
import type { ContextDraft, PackFormat } from './model';
import { ProfileSheet } from './ProfileSheet';
import styles from './Context.module.css';
import { t } from '../../i18n';

const PEOPLE_SHOWN = 10;

function useContextPack(draft: ContextDraft | null): { pack: ContextPack | null; error: string | null } {
  const [state, setState] = useState<{ pack: ContextPack | null; error: string | null }>({ pack: null, error: null });
  const run = useRef(0);
  const key = JSON.stringify(draft);
  useEffect(() => {
    if (!draft) return undefined;
    const id = ++run.current;
    const timer = window.setTimeout(() => {
      buildContextPack(draftToOptions(draft))
        .then((pack) => run.current === id && setState({ pack, error: null }))
        .catch((error: unknown) => run.current === id && setState((prev) => ({ pack: prev.pack, error: error instanceof Error ? error.message : t('Could not build the context.') })));
    }, 180);
    return () => window.clearTimeout(timer);
    // `key` stands for the whole draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}

export default function ContextScreen() {
  const settings = useSettings();
  const profile = useProfile();
  const people = usePeople();
  const projects = useProjects('active');
  const saved = usePresets();
  const toast = useToast();
  const location = useLocation();
  const personId = personFromSearch(location.search);
  const person = usePerson(personId ?? undefined);

  const [draft, setDraft] = useState<ContextDraft | null>(null);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [allPeople, setAllPeople] = useState(false);
  const appliedPerson = useRef<string | null>(null);

  // First draft: the privacy level of the settings; a deep link brings its own preset.
  useEffect(() => {
    if (!settings || draft) return;
    if (personId && person === undefined) return; // wait for the person
    const base = defaultDraft(settings.privacy.contextLevel);
    if (personId && person) {
      appliedPerson.current = personId;
      setDraft(draftFromPreset(presetForPerson(person), base));
      setActivePreset(`person:${person.id}`);
    } else {
      setDraft(base);
    }
  }, [settings, draft, personId, person]);

  const { pack, error } = useContextPack(draft);
  const chips = useMemo(() => presetChips(BUILTIN_PRESETS, saved ?? []), [saved]);

  if (!draft || !settings) return <div className={styles.screen} aria-busy="true" />;

  const update = (patch: Partial<ContextDraft>): void => {
    setActivePreset(null);
    setDraft({ ...draft, ...patch });
  };
  const shownPeople = (people ?? []).slice(0, allPeople ? undefined : PEOPLE_SHOWN);
  const text = pack ? (draft.format === 'json' ? pack.json : pack.markdown) : '';
  const tokens = pack ? pack.tokens[draft.format] : 0;
  const { ratio, nearLimit } = budgetState(tokens, draft.maxTokens);
  const reportOf = (id: string) => pack?.sections.find((section) => section.id === id);

  const copy = async (): Promise<void> => {
    if (await copyText(text)) toast.show({ message: t('Copied. Paste it into any AI chat.'), tone: 'ok', duration: 3000 });
    else toast.show({ message: t('Could not copy. Select the text below and copy it manually.'), tone: 'danger' });
  };
  const download = (format: PackFormat): void => {
    if (!pack) return;
    downloadText(packFileName(format), format === 'json' ? pack.json : pack.markdown, format === 'json' ? 'application/json' : 'text/markdown');
  };
  const savePreset = async (): Promise<void> => {
    const name = presetName.trim();
    if (name === '') return;
    try {
      await presetsRepo.create(presetFromDraft(name, draft));
      setSaveOpen(false);
      setPresetName('');
      toast.show({ message: t('Preset “{name}” saved', { name }), duration: 2500 });
    } catch (cause) {
      toast.show({ message: cause instanceof Error ? cause.message : t('Could not save the preset.'), tone: 'danger' });
    }
  };

  const personChip = person ? { key: `person:${person.id}`, name: t('Before our talk: {name}', { name: person.name }), preset: presetForPerson(person) } : null;
  const profileFilled = profile && [profile.name, profile.about, profile.goals, profile.values, profile.talkStyle].some((field) => field.trim() !== '');

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <Display as="h1" size="l" className={styles.title}>
          {t('Context for AI')}
        </Display>
        <Body tone="muted">{t('Build a short document about yourself from your notes, so any AI chat understands who it is talking to right away.')}</Body>
      </header>

      {/* Sticky summary: the number and the main action stay in reach while the controls change. */}
      <div className={styles.summary} role="region" aria-label={t('Context size')}>
        <div className={styles.summaryText}>
          <Label>{t('Size')}</Label>
          <Mono size={20} aria-label={t('Tokens: {tokens} of {maxTokens}', { tokens, maxTokens: draft.maxTokens })}>
            {formatCount(tokens)} <span className={styles.of}>/ {formatCount(draft.maxTokens)}</span>
          </Mono>
          <div className={styles.bar} aria-hidden="true">
            <div className={styles.barFill} data-near={nearLimit || undefined} style={{ width: `${Math.round(ratio * 100)}%` }} />
          </div>
        </div>
        <Button variant="primary" size="md" iconStart="share" onClick={() => void copy()} disabled={!pack}>
          {t('Copy')}
        </Button>
      </div>

      <section className={styles.block} aria-labelledby="ctx-presets">
        <Heading as="h2" variant="headline" id="ctx-presets">
          {t('Presets')}
        </Heading>
        <div className={styles.chips} role="group" aria-label={t('Presets')}>
          {personChip ? (
            <Chip
              key={personChip.key}
              selected={activePreset === personChip.key}
              onClick={() => {
                setDraft(draftFromPreset(personChip.preset, draft));
                setActivePreset(personChip.key);
              }}
            >
              {personChip.name}
            </Chip>
          ) : null}
          {chips.map((chip) => (
            <span key={chip.key} className={styles.presetChip}>
              <Chip
                selected={activePreset === chip.key}
                onClick={() => {
                  setDraft(draftFromPreset(chip.preset, draft));
                  setActivePreset(chip.key);
                }}
              >
                {chip.name}
              </Chip>
              {chip.id ? (
                <IconButton icon="close" label={t('Delete preset “{name}”', { name: chip.name })} onClick={() => void presetsRepo.remove(chip.id as string)} />
              ) : null}
            </span>
          ))}
        </div>
        <div>
          <Button size="sm" variant="ghost" iconStart="plus" onClick={() => setSaveOpen(true)}>
            {t('Save current settings')}
          </Button>
        </div>
      </section>

      <section className={styles.block} aria-labelledby="ctx-profile">
        <Heading as="h2" variant="headline" id="ctx-profile">
          {t('Who I am')}
        </Heading>
        <button type="button" className={styles.profileCard} onClick={() => setProfileOpen(true)}>
          <span className={styles.profileText}>
            {profileFilled ? (
              <>
                <strong>{profile?.name || t('No name')}</strong>
                <span className={styles.clamp}>{[profile?.about, profile?.goals].filter(Boolean).join(' · ') || t('Add what you do and where you are heading.')}</span>
              </>
            ) : (
              <>
                <strong>{t('Profile is empty')}</strong>
                <span>{t('Tell it about yourself, your goals and how to talk to you: the AI will answer more accurately.')}</span>
              </>
            )}
          </span>
          <Icon name="edit" size={20} />
          <span className="sr-only">{t('Edit profile')}</span>
        </button>
      </section>

      <section className={styles.block} aria-labelledby="ctx-sections">
        <Heading as="h2" variant="headline" id="ctx-sections">
          {t('What to include')}
        </Heading>
        <div className={styles.chips} role="group" aria-label={t('Sections')}>
          {CONTEXT_SECTIONS.map((id) => {
            const report = reportOf(id);
            return (
              <Chip key={id} selected={draft.sections.includes(id)} count={report && draft.sections.includes(id) ? report.included : undefined} onClick={() => update({ sections: toggleSection(draft.sections, id) })}>
                {CONTEXT_SECTION_TITLES[id]}
              </Chip>
            );
          })}
        </div>
      </section>

      <section className={styles.block} aria-labelledby="ctx-window">
        <Heading as="h2" variant="headline" id="ctx-window">
          {t('Which period')}
        </Heading>
        <SegmentedControl<string>
          aria-label={t('Time window')}
          options={WINDOW_CHOICES.map((days) => ({ value: String(days), label: t('{days} d', { days }) }))}
          value={String(draft.windowDays)}
          onChange={(value) => update({ windowDays: Number(value) })}
          fullWidth
          className={styles.fit}
        />
        <Caption>{t('Affects recent records, new decisions and ideas. Open commitments and predictions are included regardless of date.')}</Caption>
      </section>

      {(people?.length ?? 0) > 0 || (projects?.length ?? 0) > 0 ? (
        <section className={styles.block} aria-labelledby="ctx-filters">
          <Heading as="h2" variant="headline" id="ctx-filters">
            {t('Only about')}
          </Heading>
          {(people?.length ?? 0) > 0 ? (
            <div className={styles.chips} role="group" aria-label={t('People')}>
              {shownPeople.map((entry) => (
                <Chip key={entry.id} selected={draft.personIds.includes(entry.id)} onClick={() => update({ personIds: toggleId(draft.personIds, entry.id) })}>
                  {entry.name}
                </Chip>
              ))}
              {(people?.length ?? 0) > PEOPLE_SHOWN ? (
                <Chip onClick={() => setAllPeople((all) => !all)}>{allPeople ? t('Less') : t('{v} more', { v: (people?.length ?? 0) - PEOPLE_SHOWN })}</Chip>
              ) : null}
            </div>
          ) : null}
          {(projects?.length ?? 0) > 0 ? (
            <div className={styles.chips} role="group" aria-label={t('Projects')}>
              {projects?.map((entry) => (
                <Chip key={entry.id} selected={draft.projectIds.includes(entry.id)} onClick={() => update({ projectIds: toggleId(draft.projectIds, entry.id) })}>
                  {entry.name}
                </Chip>
              ))}
            </div>
          ) : null}
          <Caption>{t('Nothing selected: everything is included. Several selected: anything related to any of them is included.')}</Caption>
        </section>
      ) : null}

      <section className={styles.block} aria-labelledby="ctx-privacy">
        <Heading as="h2" variant="headline" id="ctx-privacy">
          {t("People's names")}
        </Heading>
        <SegmentedControl<PrivacyLevel>
          aria-label={t('Privacy level')}
          options={PRIVACY_LEVELS.map((value) => ({ value, label: PRIVACY_LABELS[value] }))}
          value={draft.privacy}
          onChange={(value) => update({ privacy: value })}
          fullWidth
          className={styles.fit}
        />
        <Caption>{PRIVACY_HINTS[draft.privacy]}</Caption>
        {pack && pack.warnings.length > 0 ? (
          <ul className={styles.warnings} aria-label={t('Warnings')}>
            {pack.warnings.map((warning) => (
              <li key={warning}>
                <Icon name="alert" size={16} />
                <span>{warning}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className={styles.block} aria-labelledby="ctx-budget">
        <Heading as="h2" variant="headline" id="ctx-budget">
          {t('Size limit')}
        </Heading>
        <SegmentedControl<string>
          aria-label={t('Token limit')}
          options={BUDGET_CHOICES.map((value) => ({ value: String(value), label: `${value / 1000}k` }))}
          value={String(draft.maxTokens)}
          onChange={(value) => update({ maxTokens: Number(value) })}
          fullWidth
          className={styles.fit}
        />
        <Caption>
          {pack?.trimmed
            ? t('The document did not fit and was shortened: the most important parts were kept. Raise the limit to include everything.')
            : t('Tokens are the units in which an AI counts text. The estimate is approximate, but on the safe side.')}
        </Caption>
      </section>

      <section className={styles.block} aria-labelledby="ctx-preview">
        <div className={styles.previewHead}>
          <Heading as="h2" variant="headline" id="ctx-preview">
            {t('Preview')}
          </Heading>
          <SegmentedControl<PackFormat>
            aria-label={t('Format')}
            size="sm"
            options={[
              { value: 'markdown', label: 'Markdown' },
              { value: 'json', label: 'JSON' },
            ]}
            value={draft.format}
            onChange={(format) => setDraft({ ...draft, format })}
          />
        </div>
        {error ? (
          <Body role="alert" className={styles.error}>
            {error}
          </Body>
        ) : null}
        <pre className={styles.preview} tabIndex={0} aria-label={t('Context text')} data-testid="context-preview">
          {pack ? text : t('Building…')}
        </pre>
        <div className={styles.actions}>
          <Button variant="secondary" size="sm" onClick={() => download('markdown')} disabled={!pack}>
            {t('Download .md')}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => download('json')} disabled={!pack}>
            {t('Download .json')}
          </Button>
        </div>
      </section>

      <ProfileSheet open={profileOpen} onClose={() => setProfileOpen(false)} />
      <Sheet open={saveOpen} onClose={() => setSaveOpen(false)} title={t('Save preset')} placement="sheet" snaps={[0.5]}>
        <form
          className={styles.sheetBody}
          onSubmit={(event) => {
            event.preventDefault();
            void savePreset();
          }}
        >
          <Body tone="muted">{t('Sections, period, filters, privacy and limit will be remembered under this name.')}</Body>
          <Field label={t('Name')} value={presetName} onChange={(event) => setPresetName(event.target.value)} placeholder={t('e.g. Call with a partner')} autoFocus />
          <Button type="submit" variant="primary" fullWidth disabled={presetName.trim() === ''}>
            {t('Save')}
          </Button>
        </form>
      </Sheet>
    </div>
  );
}
