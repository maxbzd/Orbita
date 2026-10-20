import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getSettings } from '../../db';
import { useProfile } from '../../db/hooks';
import { seedDemo } from '../../db/seed';
import { createLlmProvider, checkAiReadiness, generateReview } from '../../ai';
import { formatDayLong, formatDayShort, localDayKey, localMinutesOfDay } from '../../domain/dates';
import { greetingLine, isEveningHour, daySummary } from '../../lib/verdict';
import {
  Button,
  Caption,
  DayOrbit,
  Display,
  Icon,
  IconButton,
  Label,
  RECORD_PATH,
  useAura,
  useShell,
  useToast,
} from '../../ui';
import { BurningBlock, CheckInRow, CloseDayCard, InsightBlock, MetricChips } from './TodayBlocks';
import { buildTodayModel } from './model';
import { loadTodaySnapshot } from './snapshot';
import { useNow } from './useNow';
import styles from './Today.module.css';
import { t } from '../../i18n';

/** "СРЕДА · 7 ОКТ": the weekday and the date as a mono caption. */
function dateLabel(day: string): string {
  const weekday = formatDayLong(day).split(',')[0] ?? '';
  return `${weekday} · ${formatDayShort(day).replace(/\.$/, '')}`.toUpperCase();
}

/** Closes the day with a review: by rules, and with the model's voice when a provider is ready. */
async function closeDay(day: string): Promise<string> {
  const settings = await getSettings();
  const aiReady = settings.ai.provider !== 'manual' && checkAiReadiness(settings).ready;
  const { review } = await generateReview('day', day, { llm: aiReady ? createLlmProvider(settings) : undefined });
  return review.id;
}

/**
 * "Сегодня": greeting, the verdict of the day, the orbit of the day,
 * four metric chips and not more than four blocks below. Everything is derived from the database
 * through one live query, so a new record or a changed commitment shows up at once.
 */
export default function TodayScreen() {
  const navigate = useNavigate();
  const toast = useToast();
  const { openCommandPalette } = useShell();
  const profile = useProfile();
  const now = useNow();
  const day = localDayKey(now);
  const hour = now.getHours();

  const snapshot = useLiveQuery(() => loadTodaySnapshot(day), [day]);
  const model = useMemo(() => (snapshot ? buildTodayModel(snapshot) : null), [snapshot]);

  // Aura: the mood of the day; quieter while there is nothing to show.
  useAura(model?.auraMood ?? null, model?.isFresh ? 0.25 : 0.7);

  const [closing, setClosing] = useState(false);
  const [seeding, setSeeding] = useState(false);

  const onClose = useCallback(async () => {
    setClosing(true);
    try {
      const id = await closeDay(day);
      navigate(`/reviews/${id}`);
    } catch {
      toast.show({ message: t('Could not close the day. Your records are intact, try again.'), tone: 'danger' });
    } finally {
      setClosing(false);
    }
  }, [day, navigate, toast]);

  const onDemo = useCallback(async () => {
    setSeeding(true);
    try {
      await seedDemo();
      toast.show({ message: t('Demo data loaded. You can remove it in Settings → Data.') });
    } catch {
      toast.show({ message: t('Could not load the demo data.'), tone: 'danger' });
    } finally {
      setSeeding(false);
    }
  }, [toast]);

  const onEntry = useCallback(
    (id: string) => navigate(id.startsWith('checkin:') ? '/checkin' : `/entry/${id}`),
    [navigate],
  );

  const initial = profile?.name.trim()[0]?.toUpperCase();
  const greeting = greetingLine(hour, profile?.name);
  const summary = model ? daySummary({ captures: model.counts.captures, burning: model.burningCount }) : '';

  return (
    <section className={styles.screen} aria-label={t('Today')} aria-busy={model ? undefined : true}>
      <header className={styles.top}>
        <Label className={styles.date}>{dateLabel(day)}</Label>
        <div className={styles.topActions}>
          <IconButton icon="search" label={t('Search and actions')} variant="glass" onClick={openCommandPalette} />
          <Link to="/me" className={styles.avatar} aria-label={t('Me')}>
            {initial ? initial : <Icon name="me" size={22} />}
          </Link>
        </div>
      </header>

      <Display as="h1" size="xl" className={styles.verdict}>
        {model?.verdict ?? t('Today')}
      </Display>
      <Caption className={styles.caption}>
        {greeting}.{model ? ` ${summary}` : ''}
      </Caption>

      <div className={styles.hero}>
        <DayOrbit
          mode="full"
          mood={model?.mood ?? null}
          value={model?.burningCount ?? 0}
          valueLabel={t('Burning')}
          entries={model?.entries}
          satellites={model?.satellites}
          nowMinutes={localMinutesOfDay(now)}
          label={t('Orbit of the day')}
          planetLabel={t('Open the orbit of the day')}
          onPlanetClick={() => navigate('/orbit')}
          onEntryClick={onEntry}
          onSatelliteClick={() => navigate('/items/commitment')}
          onOverflowClick={() => navigate('/items/commitment')}
        />
      </div>

      {model?.isFresh ? (
        <div className={styles.fresh}>
          <p className={styles.freshTitle}>{t("Quiet for now. Say your first thought, I'll sort it out.")}</p>
          <div className={styles.freshActions}>
            <Button variant="primary" iconStart="mic" onClick={() => navigate(RECORD_PATH)}>
              {t('Record', undefined, 'today-screen')}
            </Button>
            <Button variant="secondary" loading={seeding} onClick={() => void onDemo()}>
              {t('Load demo data')}
            </Button>
          </div>
        </div>
      ) : null}

      {model && snapshot && !model.isFresh ? (
        <>
          <MetricChips model={model} />
          <BurningBlock model={model} />
          <InsightBlock pattern={snapshot.pattern} review={snapshot.review} recordsTotal={snapshot.recordsTotal} />
          <CheckInRow model={model} />
          {isEveningHour(hour) ? (
            <CloseDayCard model={model} reviewId={snapshot.dayReview?.id ?? null} busy={closing} onClose={() => void onClose()} />
          ) : null}
        </>
      ) : null}
    </section>
  );
}
