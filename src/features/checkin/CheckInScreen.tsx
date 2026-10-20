import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { checkinsRepo } from '../../db';
import { useCheckIns } from '../../db/hooks';
import { addDays, formatTime, localDayKey, relativeDay } from '../../domain/dates';
import type { CheckIn } from '../../domain/types';
import {
  Button,
  Caption,
  Chip,
  Display,
  Icon,
  IconButton,
  Label,
  MoodFlower,
  MoodSlider,
  SegmentedControl,
  TextArea,
  clampMood,
  moodHex,
  moodWord,
  useHideNavigation,
  useToast,
} from '../../ui';
import type { MoodStep } from '../../ui';
import { ENERGY_OPTIONS, draftToCheckIn, moodFactors, toTag, wordsForMood } from './logic';
import type { EnergyLevel } from './logic';
import styles from './CheckIn.module.css';
import { t } from '../../i18n';

type Step = 1 | 2 | 3;

const STEP_TITLES: Record<Step, string> = {
  get 1() { return t('How are you right now?') },
  get 2() { return t('Which words fit?') },
  get 3() { return t('What is affecting this?') },
};

/** AI-suggested states from the last days that wait for the user's answer. */
function Suggestions({ items }: { items: readonly CheckIn[] }) {
  const toast = useToast();
  if (items.length === 0) return null;

  const confirm = (checkIn: CheckIn): void => {
    void checkinsRepo.confirm(checkIn.id).then(() => toast.show({ message: t('State confirmed.') }));
  };
  const dismiss = (checkIn: CheckIn): void => {
    void checkinsRepo.remove(checkIn.id).then(() =>
      toast.show({ message: t('State removed.'), actionLabel: t('Restore'), onAction: () => void checkinsRepo.restore(checkIn.id) }),
    );
  };

  return (
    <section className={styles.suggestions} aria-labelledby="checkin-suggested">
      <Label as="h2" id="checkin-suggested">
        {t('AI noticed in your notes')}
      </Label>
      <ul>
        {items.map((checkIn) => (
          <li key={checkIn.id} className={styles.suggestion}>
            <MoodFlower value={checkIn.valence * 3} size={28} decorative />
            <span className={styles.suggestionText}>
              <strong>{moodWord(checkIn.valence * 3)}</strong>
              <Caption>
                {relativeDay(checkIn.day)}, {formatTime(checkIn.at)}
                {checkIn.tags.length > 0 ? ` · ${checkIn.tags.slice(0, 3).join(', ')}` : ''}
              </Caption>
            </span>
            <Button size="sm" variant="secondary" onClick={() => confirm(checkIn)}>
              {t('Confirm')}
            </Button>
            <IconButton icon="close" label={t('Remove this state')} onClick={() => dismiss(checkIn)} />
          </li>
        ))}
      </ul>
      <Caption tone="faint">{t('AI can be wrong. Check it.')}</Caption>
    </section>
  );
}

/**
 * "Состояние": a full-screen sheet tinted with the colour of the mood.
 * Step 1 is the flower and the seven-step slider (and enough on its own), step 2 the words, step 3 what
 * affects it. A step saves what is known so far, so leaving after any step loses nothing.
 */
export default function CheckInScreen() {
  useHideNavigation();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();

  const [step, setStep] = useState<Step>(1);
  const [mood, setMood] = useState<MoodStep>(0);
  const [preview, setPreview] = useState<number>(0);
  const [energy, setEnergy] = useState<EnergyLevel>('mid');
  const [words, setWords] = useState<string[]>([]);
  const [factors, setFactors] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [hideFromAi, setHideFromAi] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const savedId = useRef<string | null>(null);

  const today = localDayKey();
  const recent = useCheckIns(addDays(today, -6), today);
  const suggested = useMemo(() => (recent ?? []).filter((checkIn) => checkIn.origin === 'ai_suggested').reverse(), [recent]);

  const tint = moodHex(clampMood(preview));
  const wordSet = useMemo(() => wordsForMood(mood), [mood]);
  const shownWords = useMemo(() => {
    const base = showMore ? [...wordSet.featured, ...wordSet.more] : [...wordSet.featured];
    // A word picked under another mood stays visible and selected.
    return [...base, ...words.filter((word) => !base.includes(word))];
  }, [wordSet, showMore, words]);

  // Each step moves the reader's attention to its heading.
  useEffect(() => {
    if (step > 1) document.getElementById('checkin-title')?.focus();
  }, [step]);

  const leave = useCallback(() => {
    if (location.key === 'default') navigate('/today', { replace: true });
    else navigate(-1);
  }, [location.key, navigate]);

  const persist = useCallback(async (): Promise<void> => {
    const input = draftToCheckIn({ step: mood, energy, words, factors, note, hideFromAi });
    if (savedId.current) {
      await checkinsRepo.update(savedId.current, { valence: input.valence, energy: input.energy, tags: input.tags, note: input.note });
    } else {
      savedId.current = (await checkinsRepo.create(input)).id;
    }
  }, [mood, energy, words, factors, note, hideFromAi]);

  const next = useCallback(async () => {
    setBusy(true);
    try {
      await persist();
      setStep((s) => (s < 3 ? ((s + 1) as Step) : s));
    } catch {
      toast.show({ message: t('Could not save the state.'), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }, [persist, toast]);

  const finish = useCallback(async () => {
    setBusy(true);
    try {
      await persist();
      toast.show({ message: t('Saved.') });
      leave();
    } catch {
      toast.show({ message: t('Could not save the state.'), tone: 'danger' });
      setBusy(false);
    }
  }, [persist, leave, toast]);

  const toggle = (list: string[], set: (next: string[]) => void, value: string): void => {
    const tag = toTag(value);
    set(list.includes(tag) ? list.filter((item) => item !== tag) : [...list, tag]);
  };

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Escape') leave();
  };

  return (
    <section className={styles.screen} style={{ '--mood': tint } as React.CSSProperties} aria-label={t('State')} onKeyDown={onKeyDown}>
      <div className={styles.column}>
        <header className={styles.top}>
          <IconButton icon="close" label={t('Close')} variant="glass" onClick={leave} />
          <Label className={styles.stepLabel}>{t('Step {step} of 3', { step })}</Label>
          <Chip
            size="lg"
            selected={hideFromAi}
            leading={<Icon name="lock" size={16} />}
            onClick={() => setHideFromAi((value) => !value)}
            title={t('This state will not appear in reviews, patterns or questions to the AI')}
          >
            {t('Hide from AI')}
          </Chip>
        </header>

        <Display as="h1" size="l" id="checkin-title" className={styles.title} tabIndex={-1}>
          {STEP_TITLES[step]}
        </Display>
        {hideFromAi ? (
          <Caption className={styles.hiddenNote} role="status">
            {t('The AI will not see this entry. It stays only with you.')}
          </Caption>
        ) : null}

        <div className={styles.body}>
          {step === 1 ? (
            <>
              <MoodSlider value={mood} onChange={setMood} onPreview={setPreview} label={t('State')} />
              <div className={styles.energy}>
                <Label>{t('Energy')}</Label>
                <SegmentedControl<EnergyLevel> aria-label={t('Energy')} options={ENERGY_OPTIONS} value={energy} onChange={setEnergy} fullWidth />
              </div>
              <Suggestions items={suggested} />
            </>
          ) : null}

          {step === 2 ? (
            <div className={styles.stepBody}>
              <div className={styles.flowerSmall}>
                <MoodFlower value={mood} size={64} animate decorative />
                <Display as="p" size="l" italic>
                  {moodWord(mood)}
                </Display>
              </div>
              <ul className={styles.chips} aria-label={t('Words')}>
                {shownWords.map((word) => (
                  <li key={word}>
                    <Chip size="lg" selected={words.includes(toTag(word))} leading={words.includes(toTag(word)) ? <Icon name="check" size={16} /> : undefined} onClick={() => toggle(words, setWords, word)}>
                      {word}
                    </Chip>
                  </li>
                ))}
                {!showMore ? (
                  <li>
                    <Chip size="lg" onClick={() => setShowMore(true)} leading={<Icon name="plus" size={16} />}>
                      {t('More')}
                    </Chip>
                  </li>
                ) : null}
              </ul>
            </div>
          ) : null}

          {step === 3 ? (
            <div className={styles.stepBody}>
              <ul className={styles.chips} aria-label={t('What affects it')}>
                {moodFactors().map((factor) => (
                  <li key={factor}>
                    <Chip size="lg" selected={factors.includes(toTag(factor))} leading={factors.includes(toTag(factor)) ? <Icon name="check" size={16} /> : undefined} onClick={() => toggle(factors, setFactors, factor)}>
                      {factor}
                    </Chip>
                  </li>
                ))}
              </ul>
              <TextArea label={t('A few words for yourself')} value={note} onChange={(event) => setNote(event.target.value)} placeholder={t('Optional')} rows={3} maxLength={400} />
            </div>
          ) : null}
        </div>

        <footer className={styles.footer}>
          {step > 1 ? (
            <Button variant="ghost" onClick={() => setStep((s) => (s > 1 ? ((s - 1) as Step) : s))} disabled={busy}>
              {t('Back')}
            </Button>
          ) : null}
          {step < 3 ? (
            <Button variant="secondary" onClick={() => void next()} disabled={busy} iconEnd="chevron-right">
              {t('Next')}
            </Button>
          ) : null}
          <Button variant="primary" loading={busy} onClick={() => void finish()}>
            {t('Done')}
          </Button>
        </footer>
      </div>
    </section>
  );
}
