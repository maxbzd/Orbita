import { useId } from 'react';
import type { ChangeEvent, CSSProperties } from 'react';
import type { ID, IdeaStage, Person, Project, TaskPriority } from '../../domain/types';
import { IDEA_STAGES } from '../../domain/types';
import { Chip, Field, Label, SegmentedControl, TextArea } from '../../ui';
import type { ItemDraft } from './draft';
import { formatPercent } from './draft';
import { STAGE_LABELS } from './model';
import styles from './ItemForm.module.css';
import { t } from '../../i18n';

export interface ItemFormProps {
  draft: ItemDraft;
  onChange(next: ItemDraft): void;
  people: readonly Person[];
  projects: readonly Project[];
  /** Message for the first problem (shown under the title). */
  error?: string | null;
  autoFocusTitle?: boolean;
}

const PRIORITIES: ReadonlyArray<{ value: TaskPriority | ''; label: string }> = [
  { value: '', get label() { return t('Not set') } },
  { value: 'low', get label() { return t('Low', undefined, 'priority') } },
  { value: 'normal', get label() { return t('Normal') } },
  { value: 'high', get label() { return t('High', undefined, 'priority') } },
];

const DUE_LABELS: Partial<Record<ItemDraft['kind'], { label: string; hint?: string }>> = {
  commitment: { get label() { return t('Due') } },
  task: { get label() { return t('Due') } },
  decision: { get label() { return t('Review by') }, get hint() { return t('A date to ask yourself: “how did it turn out?”') } },
  prediction: { get label() { return t('Becomes known by') }, get hint() { return t('Then the prediction shows up in “To close”.') } },
};

const MAX_PEOPLE_CHIPS = 12;

/** The fields of an object: the same form creates a new one and edits an existing one. */
export function ItemForm({ draft, onChange, people, projects, error, autoFocusTitle }: ItemFormProps) {
  const set = <K extends keyof ItemDraft>(key: K, value: ItemDraft[K]): void => onChange({ ...draft, [key]: value });
  const text =
    (key: keyof ItemDraft) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>): void =>
      set(key, event.target.value as never);
  const due = DUE_LABELS[draft.kind];
  const selectId = useId();

  const toggle = (key: 'personIds' | 'projectIds', id: ID): void =>
    set(key, draft[key].includes(id) ? draft[key].filter((value) => value !== id) : [...draft[key], id]);

  const livePeople = people.filter((person) => !person.archived || draft.personIds.includes(person.id));
  const shownPeople = [
    ...livePeople.filter((person) => draft.personIds.includes(person.id)),
    ...livePeople
      .filter((person) => !draft.personIds.includes(person.id))
      .sort((a, b) => b.mentionCount - a.mentionCount)
      .slice(0, MAX_PEOPLE_CHIPS),
  ];

  return (
    <div className={styles.form}>
      <Field
        label={t('Essence')}
        value={draft.title}
        onChange={text('title')}
        error={error ?? undefined}
        autoFocus={autoFocusTitle}
        autoComplete="off"
        placeholder={PLACEHOLDERS[draft.kind]}
      />

      {draft.kind === 'commitment' ? (
        <>
          <SegmentedControl
            aria-label={t('Direction')}
            fullWidth
            value={draft.direction}
            onChange={(value) => set('direction', value)}
            options={[
              { value: 'i_owe', label: t('I owe') },
              { value: 'owed_to_me', label: t('Owed to me') },
            ]}
          />
          <div className={styles.field}>
            <label className={styles.label} htmlFor={selectId}>
              {draft.direction === 'i_owe' ? t('Owed to') : t('Owed by')}
            </label>
            <select id={selectId} className={styles.select} value={draft.counterpartyId} onChange={text('counterpartyId')}>
              <option value="">{t('Not from the list')}</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </div>
          {draft.counterpartyId === '' ? (
            <Field label={t('Name', undefined, 'item-form')} value={draft.counterpartyName} onChange={text('counterpartyName')} autoComplete="off" placeholder={t('For example, Sam')} />
          ) : null}
        </>
      ) : null}

      {draft.kind === 'decision' ? (
        <>
          <Field label={t('Question')} value={draft.question} onChange={text('question')} autoComplete="off" placeholder={t('What was I deciding?')} />
          <Field label={t('What I chose')} value={draft.chosen} onChange={text('chosen')} autoComplete="off" hint={t('If empty, I will use the essence.')} />
          <TextArea label={t('Alternatives')} value={draft.alternatives} onChange={text('alternatives')} rows={2} autoGrow hint={t('One per line.')} />
          <TextArea label={t('Reasons')} value={draft.reasons} onChange={text('reasons')} rows={2} autoGrow hint={t('One per line.')} />
          <Field label={t('What I expect')} value={draft.expected} onChange={text('expected')} autoComplete="off" />
        </>
      ) : null}

      {draft.kind === 'prediction' ? <ProbabilitySlider value={draft.probability} onChange={(value) => set('probability', value)} /> : null}

      {due ? <Field type="date" label={due.label} value={draft.dueDay} onChange={text('dueDay')} hint={due.hint} /> : null}

      {draft.kind === 'idea' ? (
        <div className={styles.field}>
          <Label as="span">{t('Stage')}</Label>
          <div className={styles.chips} role="group" aria-label={t('Stage')}>
            {IDEA_STAGES.map((stage: IdeaStage) => (
              <Chip key={stage} selected={draft.stage === stage} onClick={() => set('stage', stage)}>
                {STAGE_LABELS[stage]}
              </Chip>
            ))}
          </div>
        </div>
      ) : null}

      {draft.kind === 'task' ? (
        <>
          <div className={styles.field}>
            <Label as="span">{t('Priority')}</Label>
            <div className={styles.chips} role="group" aria-label={t('Priority')}>
              {PRIORITIES.map((priority) => (
                <Chip key={priority.value} selected={draft.priority === priority.value} onClick={() => set('priority', priority.value)}>
                  {priority.label}
                </Chip>
              ))}
            </div>
          </div>
          <Field type="date" label={t('Plan for a day')} value={draft.scheduledFor} onChange={text('scheduledFor')} />
        </>
      ) : null}

      {draft.kind === 'question' ? <TextArea label={t('Answer')} value={draft.answer} onChange={text('answer')} rows={2} autoGrow hint={t('Empty for now — the question stays open.')} /> : null}
      {draft.kind === 'fact' ? <Field label={t('Value')} value={draft.value} onChange={text('value')} autoComplete="off" placeholder={t('For example, 14 users')} /> : null}

      <TextArea label={t('Description')} value={draft.body} onChange={text('body')} rows={2} autoGrow placeholder={t('Details, if needed')} />

      {shownPeople.length > 0 ? (
        <div className={styles.field}>
          <Label as="span">{t('People')}</Label>
          <div className={styles.chips} role="group" aria-label={t('People')}>
            {shownPeople.map((person) => (
              <Chip key={person.id} type="person" selected={draft.personIds.includes(person.id)} onClick={() => toggle('personIds', person.id)}>
                {person.name}
              </Chip>
            ))}
          </div>
        </div>
      ) : null}
      {projects.length > 0 ? (
        <div className={styles.field}>
          <Label as="span">{t('Projects')}</Label>
          <div className={styles.chips} role="group" aria-label={t('Projects')}>
            {projects.map((project) => (
              <Chip key={project.id} type="project" selected={draft.projectIds.includes(project.id)} onClick={() => toggle('projectIds', project.id)}>
                {project.name}
              </Chip>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

const PLACEHOLDERS: Record<ItemDraft['kind'], string> = {
  get commitment() { return t('What was promised') },
  get decision() { return t('What I decided') },
  get idea() { return t('The idea in one phrase') },
  get prediction() { return t('What will happen') },
  get task() { return t('Next step') },
  get question() { return t('What I want to understand') },
  get lesson() { return t('What I understood') },
  get fact() { return t('What stays true') },
};

export interface ProbabilitySliderProps {
  /** 1..99 */
  value: number;
  onChange(value: number): void;
  label?: string;
}

/** The probability of a forecast: a number that is always readable next to the slider. */
export function ProbabilitySlider({ value, onChange, label = t('Probability') }: ProbabilitySliderProps) {
  const id = useId();
  return (
    <div className={styles.field}>
      <div className={styles.sliderHead}>
        <label className={styles.label} htmlFor={id}>
          {label}
        </label>
        <output className={styles.percent} htmlFor={id}>
          {formatPercent(value)}
        </output>
      </div>
      <input
        id={id}
        type="range"
        className={styles.slider}
        min={1}
        max={99}
        step={1}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-valuetext={formatPercent(value)}
        style={{ '--fill': `${value}%` } as CSSProperties}
      />
      <div className={styles.sliderScale} aria-hidden="true">
        <span>{t('unlikely')}</span>
        <span>{t('50/50')}</span>
        <span>{t('almost certain')}</span>
      </div>
    </div>
  );
}
