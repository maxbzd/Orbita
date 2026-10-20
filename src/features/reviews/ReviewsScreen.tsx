import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useCheckIns, useReviews } from '../../db/hooks';
import { isDayKey, localDayKey, shiftPeriod, startOfWeek, weekdayIndex } from '../../domain/dates';
import type { Review, ReviewPeriod } from '../../domain/types';
import { loadPosterFont } from '../../styles/fonts';
import { Body, Button, Caption, Display, EmptyState, Heading, Label, ListRow, SegmentedControl, Skeleton, useToast } from '../../ui';
import { makeReview } from './actions';
import { useAiReadyForReviews } from './hooks';
import { PERIOD_LABEL, answersSummary, buildSlides, periodStart, reviewTitle } from './model';
import { SlideView } from './slides';
import styles from './Reviews.module.css';
import { t } from '../../i18n';

type MakePeriod = 'week' | 'month' | 'year';
type Which = 'current' | 'previous';
type Filter = 'all' | ReviewPeriod;

const MAKE_OPTIONS = [
  { value: 'week', get label() { return t('Week') } },
  { value: 'month', get label() { return t('Month') } },
  { value: 'year', get label() { return t('Year') } },
] as const;
const WHICH_OPTIONS = [
  { value: 'current', get label() { return t('Current', undefined, 'period') } },
  { value: 'previous', get label() { return t('Previous') } },
] as const;
const FILTER_OPTIONS = [
  { value: 'all', get label() { return t('All') } },
  { value: 'week', get label() { return t('Weeks') } },
  { value: 'month', get label() { return t('Months') } },
  { value: 'year', get label() { return t('Years') } },
  { value: 'day', get label() { return t('Days') } },
] as const;

/** The pace of a generation, said honestly: rules are instant, the model takes a while. */
function useMaker(aiReady: boolean | undefined) {
  const navigate = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const make = useCallback(
    async (key: string, period: ReviewPeriod, anchorDay: string): Promise<void> => {
      if (busy) return;
      setBusy(key);
      try {
        const result = await makeReview(period, anchorDay);
        if (result.aiError) toast.show({ message: t('The AI did not answer, the review was built by rules.') });
        navigate(`/reviews/${result.review.id}`);
      } catch {
        toast.show({ message: t('Could not build the review. Your records are intact, try again.'), tone: 'danger' });
      } finally {
        setBusy(null);
      }
    },
    [busy, navigate, toast],
  );
  return { busy, make, status: busy ? (aiReady ? t('Gathering the numbers and asking the AI to write the text…') : t('Gathering the numbers from your records…')) : null };
}

// ───────── "Чтение недели" ─────────

function WeekReading({ today, review, loading, maker }: { today: string; review: Review | undefined; loading: boolean; maker: ReturnType<typeof useMaker> }) {
  const navigate = useNavigate();
  const sunday = weekdayIndex(today) === 6;
  const week = startOfWeek(today);
  return (
    <section className={styles.hero} aria-labelledby="reviews-week">
      <Label as="p">{sunday ? t('Sunday reading') : t('Weekly reading')}</Label>
      <Heading as="h2" variant="title" id="reviews-week">
        {review ? review.headline || reviewTitle(review) : t('What happened this week')}
      </Heading>
      <Body tone="muted">
        {sunday
          ? t('Sunday evening: five cards about numbers, wins, overdue items and what keeps repeating.')
          : review
            ? t('The reading is already built. You can rebuild it when more records arrive.')
            : t('The week is still going, but you can build the reading now: it will show totals so far.')}
      </Body>
      {loading ? (
        <Skeleton height={56} />
      ) : review ? (
        <Button variant="primary" fullWidth onClick={() => navigate(`/reviews/${review.id}`)}>
          {t('Open the reading')}
        </Button>
      ) : (
        <Button variant="primary" fullWidth loading={maker.busy === 'week-hero'} disabled={maker.busy !== null} onClick={() => void maker.make('week-hero', 'week', week)}>
          {t('Build the weekly reading')}
        </Button>
      )}
    </section>
  );
}

// ───────── Ticket of the day ─────────

function DayTicketCard({ day, review, maker }: { day: string; review: Review | undefined; maker: ReturnType<typeof useMaker> }) {
  const navigate = useNavigate();
  const checkIns = useCheckIns(day, day);
  const spec = useMemo(() => {
    if (!review || !checkIns) return undefined;
    const sorted = [...checkIns].sort((a, b) => a.at.localeCompare(b.at));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const slides = buildSlides(review, { today: localDayKey(), dayMood: { from: first ? first.valence * 3 : null, to: last && last !== first ? last.valence * 3 : null } });
    return slides.find((slide) => slide.type === 'ticket');
  }, [review, checkIns]);

  return (
    <section className={styles.ticketCard} aria-labelledby="reviews-ticket">
      <Label as="p">{t('Ticket of the day')}</Label>
      <Heading as="h2" variant="headline" id="reviews-ticket">
        {review ? t('Summary of the day') : t('No summary for this day yet')}
      </Heading>
      {spec ? (
        <div className={styles.ticketFrame}>
          <SlideView spec={spec} />
        </div>
      ) : review ? (
        <Skeleton height={160} />
      ) : (
        <Body tone="muted">{t("I will build it from this day's records: numbers, mood in the morning and evening.")}</Body>
      )}
      {review ? (
        <Button variant="secondary" fullWidth onClick={() => navigate(`/reviews/${review.id}`)}>
          {t('Open day summaries')}
        </Button>
      ) : (
        <Button variant="primary" fullWidth loading={maker.busy === 'day'} disabled={maker.busy !== null} onClick={() => void maker.make('day', 'day', day)}>
          {t('Build the day summary')}
        </Button>
      )}
    </section>
  );
}

// ───────── Passport of the year ─────────

function YearPassport({ today, review, loading, maker }: { today: string; review: Review | undefined; loading: boolean; maker: ReturnType<typeof useMaker> }) {
  const navigate = useNavigate();
  const year = today.slice(0, 4);
  const spec = useMemo(() => (review ? buildSlides(review, { today }).find((slide) => slide.type === 'passport') : undefined), [review, today]);
  return (
    <section className={styles.passportCard} aria-labelledby="reviews-passport">
      <div className={styles.passportText}>
        <Label as="p">{t('Year passport')}</Label>
        <Heading as="h2" variant="headline" id="reviews-passport">
          {t('Passport {year}', { year })}
        </Heading>
        <Body tone="muted">
          {review ? t('The main number of the year and the four figures behind it. You can save it as an image.') : t("It will be built from the year's records: one number, four figures and the lines behind them.")}
        </Body>
        {loading ? null : review ? (
          <Button variant="secondary" onClick={() => navigate(`/reviews/${review.id}`)}>
            {t('Open the year')}
          </Button>
        ) : (
          <Button variant="secondary" loading={maker.busy === 'year-passport'} disabled={maker.busy !== null} onClick={() => void maker.make('year-passport', 'year', today)}>
            {t('Build the passport')}
          </Button>
        )}
      </div>
      {spec ? (
        <div className={styles.passportFrame}>
          <SlideView spec={spec} />
        </div>
      ) : null}
    </section>
  );
}

// ───────── The screen ─────────

/** `/reviews`: the weekly reading as the main card, the year passport, a form for any period and the list of past reviews. */
export default function ReviewsScreen() {
  const [params] = useSearchParams();
  const dayParam = params.get('day');
  const day = dayParam && isDayKey(dayParam) ? dayParam : null;
  const today = useMemo(() => localDayKey(), []);
  const reviews = useReviews();
  const aiReady = useAiReadyForReviews();
  const maker = useMaker(aiReady);
  const navigate = useNavigate();
  const [makePeriod, setMakePeriod] = useState<MakePeriod>('week');
  const [which, setWhich] = useState<Which>('current');
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    void loadPosterFont();
  }, []);

  const find = (period: ReviewPeriod, startDay: string): Review | undefined => reviews?.find((review) => review.period === period && review.startDay === startDay);
  const weekReview = find('week', startOfWeek(today));
  const yearReview = find('year', periodStart('year', today));
  const dayReview = day ? find('day', day) : undefined;
  const visible = (reviews ?? []).filter((review) => filter === 'all' || review.period === filter);
  const loading = reviews === undefined;

  const anchor = which === 'current' ? today : shiftPeriod(makePeriod, today, -1).startDay;
  const targetExists = find(makePeriod, periodStart(makePeriod, anchor));

  return (
    <section className={styles.screen} aria-labelledby="reviews-title">
      <header className={styles.listHead}>
        <Display as="h1" size="l" id="reviews-title">
          {t('Reviews')}
        </Display>
        <Caption>{t('Summaries of weeks, months and years. Numbers are counted from your records, the AI only writes the text.')}</Caption>
      </header>

      {day ? <DayTicketCard day={day} review={dayReview} maker={maker} /> : null}
      <WeekReading today={today} review={weekReview} loading={loading} maker={maker} />
      <YearPassport today={today} review={yearReview} loading={loading} maker={maker} />

      <section className={styles.make} aria-labelledby="reviews-make">
        <Heading as="h2" variant="headline" id="reviews-make">
          {t('Create a review for a period')}
        </Heading>
        <div className={styles.makeControls}>
          <SegmentedControl<MakePeriod> aria-label={t('Period')} options={MAKE_OPTIONS} value={makePeriod} onChange={setMakePeriod} />
          <SegmentedControl<Which> aria-label={t('Which one')} options={WHICH_OPTIONS} value={which} onChange={setWhich} />
        </div>
        <Caption tone="faint" role="status">
          {maker.status ?? (aiReady ? t('The AI will add text to the numbers. A review works without it too.') : t('Without an AI key a review is built by rules: numbers, lists and questions. Add a key in Settings → AI.'))}
        </Caption>
        <Button
          variant="secondary"
          fullWidth
          loading={maker.busy === 'make'}
          disabled={maker.busy !== null}
          onClick={() => void maker.make('make', makePeriod, anchor)}
        >
          {targetExists ? t('Rebuild the review') : t('Create the review')}
        </Button>
      </section>

      <section className={styles.list} aria-labelledby="reviews-list">
        <Heading as="h2" variant="headline" id="reviews-list">
          {t('All reviews')}
        </Heading>
        <SegmentedControl<Filter> aria-label={t('Which reviews to show')} size="sm" options={FILTER_OPTIONS} value={filter} onChange={setFilter} />
        {loading ? (
          <Skeleton height={72} shape="block" />
        ) : visible.length === 0 ? (
          <EmptyState
            compact
            title={filter === 'all' ? t('No reviews yet. You can build the first one above.') : t('{v}: no reviews yet.', { v: PERIOD_LABEL[filter] })}
            description={filter === 'all' ? t('You need at least a few records in the period.') : undefined}
          />
        ) : (
          <ul className={styles.rows}>
            {visible.map((review) => (
              <ListRow
                key={review.id}
                as="li"
                title={reviewTitle(review)}
                subtitle={[review.headline, answersSummary(review)].filter(Boolean).join(' · ')}
                onClick={() => navigate(`/reviews/${review.id}`)}
              />
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
