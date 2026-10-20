import { useMemo, useState } from 'react';
import { t, tn } from '../../i18n';
import { addDays, formatDayRange, formatMonthYear, periodRange } from '../../domain/dates';
import type { DayKey } from '../../domain/types';
import { DayDisk, IconButton, MonthRing, SegmentedControl, WeekOrbit, YearSky, Button, Caption, Label } from '../../ui';
import type { DayCell } from '../../ui';
import { diskMoods, diskSegments } from './model';
import type { DayDetails, Layers, PeriodSummary, TimeView } from './model';
import styles from './Orbit.module.css';

interface TimeFigureProps {
  view: TimeView;
  day: DayKey;
  today: DayKey;
  minutes: number;
  cells: readonly DayCell[];
  summary: PeriodSummary;
  details: DayDetails;
  layers: Layers;
  size: number;
  selectedSegment: string | null;
  onSelectSegment(id: string | null): void;
  onSelectDay(day: DayKey): void;
  onSelectView(view: TimeView, day?: DayKey): void;
  onShift(delta: -1 | 1): void;
}

/** Title of the shown period: «5–11 окт.», «Октябрь 2026», «2026». */
export function periodTitle(view: TimeView, day: DayKey): string {
  const range = periodRange(view, day);
  if (view === 'day') return formatDayRange(range.startDay, range.endDay);
  if (view === 'week') return formatDayRange(range.startDay, range.endDay);
  if (view === 'month') return formatMonthYear(day);
  return String(range.startDay.slice(0, 4));
}

/** The figure of the chosen view: the day disk, the week orbit, the month ring or the year sky. */
export function TimeFigure({
  view,
  day,
  today,
  minutes,
  cells,
  summary,
  details,
  layers,
  size,
  selectedSegment,
  onSelectSegment,
  onSelectDay,
  onSelectView,
  onShift,
}: TimeFigureProps) {
  const [yearStyle, setYearStyle] = useState<'garden' | 'dots'>('garden');
  const segments = useMemo(() => diskSegments(details, layers), [details, layers]);
  const moods = useMemo(() => (layers.state ? diskMoods(details.checkIns) : []), [details.checkIns, layers.state]);
  const range = periodRange(view, day);
  const containsToday = today >= range.startDay && today <= range.endDay;
  const recordsWord = tn(summary.records, 'record', 'records');

  return (
    <div className={styles.figureBlock}>
      {view !== 'day' ? (
        <div className={styles.periodBar}>
          <IconButton icon="chevron-left" label={view === 'week' ? t('Previous week') : view === 'month' ? t('Previous month') : t('Previous year')} onClick={() => onShift(-1)} />
          <Label as="h2" tone="strong" className={styles.periodTitle} aria-live="polite">
            {periodTitle(view, day)}
          </Label>
          <IconButton icon="chevron-right" label={view === 'week' ? t('Next week') : view === 'month' ? t('Next month') : t('Next year')} onClick={() => onShift(1)} />
        </div>
      ) : null}

      <div className={styles.figure}>
        {view === 'day' ? (
          <DayDisk
            date={day}
            segments={segments}
            moods={moods}
            nowMinutes={day === today ? minutes : null}
            selectedId={selectedSegment}
            onSelect={onSelectSegment}
            onStepDay={(delta) => onSelectDay(addDays(day, delta))}
            size={size}
          />
        ) : null}
        {view === 'week' ? (
          <WeekOrbit
            week={day}
            days={cells}
            today={today}
            selected={day}
            onSelect={onSelectDay}
            cursor={containsToday ? { date: today, minutes } : null}
            value={summary.records}
            valueLabel={recordsWord}
            size={size}
            label={t('Week orbit')}
          />
        ) : null}
        {view === 'month' ? (
          <MonthRing
            month={day.slice(0, 7)}
            days={cells}
            today={today}
            selected={day}
            onSelect={onSelectDay}
            value={summary.records}
            valueLabel={recordsWord}
            size={size}
            label={t('Month ring')}
          />
        ) : null}
        {view === 'year' ? (
          <>
            <YearSky
              year={Number(day.slice(0, 4))}
              days={cells}
              today={today}
              selected={day}
              onSelect={onSelectDay}
              onSelectMonth={(month) => onSelectView('month', `${month}-01`)}
              variant={yearStyle}
              size={Math.max(size, 340)}
              label={t('Year sky')}
            />
            <div className={styles.yearTools}>
              <SegmentedControl<'garden' | 'dots'>
                size="sm"
                aria-label={t('Year view')}
                value={yearStyle}
                onChange={setYearStyle}
                options={[
                  { value: 'garden', label: t('Garden') },
                  { value: 'dots', label: t('Dots') },
                ]}
              />
              <Caption>{t("A month's name opens it.")}</Caption>
            </div>
          </>
        ) : null}
      </div>

      {view !== 'day' && !containsToday ? (
        <Button variant="ghost" size="sm" onClick={() => onSelectDay(today)} className={styles.toToday}>
          {t('Back to today')}
        </Button>
      ) : null}
    </div>
  );
}
