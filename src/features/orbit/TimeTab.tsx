import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { addDays, periodRange, shiftPeriod } from '../../domain/dates';
import type { DayKey } from '../../domain/types';
import { Body, Caption, Chip, EmptyState, Skeleton, SegmentedControl, cx } from '../../ui';
import { useBreakpoint } from '../../styles';
import { DayDetailsPanel } from './DayDetailsPanel';
import { DayStrip } from './DayStrip';
import { TimeFigure } from './TimeFigure';
import { TrendBlock } from './TrendBlock';
import {
  ALL_LAYERS,
  LAYERS,
  LAYER_LABELS,
  LAYER_TYPE,
  TIME_VIEWS,
  VIEW_LABELS,
  buildDayCells,
  buildDayDetails,
  countDue,
  countPatternsSeen,
  detectTrend,
  emptyTimeTitle,
  parseDay,
  parseView,
  summarizePeriod,
  topTags,
  trendPeriod,
} from './model';
import type { Layer, Layers, TimeView } from './model';
import { loadTimeSnapshot } from './snapshot';
import { useToday } from './useToday';
import styles from './Orbit.module.css';
import { t } from '../../i18n';

const LAYERS_KEY = 'orbit.layers';

function readLayers(): Layers {
  try {
    const raw = window.localStorage.getItem(LAYERS_KEY);
    if (!raw) return ALL_LAYERS;
    const parsed = JSON.parse(raw) as Partial<Record<Layer, unknown>>;
    return Object.fromEntries(LAYERS.map((layer) => [layer, typeof parsed[layer] === 'boolean' ? parsed[layer] : true])) as unknown as Layers;
  } catch {
    return ALL_LAYERS;
  }
}

function writeLayers(layers: Layers): void {
  try {
    window.localStorage.setItem(LAYERS_KEY, JSON.stringify(layers));
  } catch {
    /* a private window: the choice simply is not remembered */
  }
}

/** «Орбита → Время» (SPEC §4.7): day / week / month / year, layer chips, the day strip, the trend and the day's details. */
export function TimeTab() {
  const [params, setParams] = useSearchParams();
  const { today, minutes } = useToday();
  const breakpoint = useBreakpoint();
  const view = parseView(params.get('view'));
  const day = parseDay(params.get('day'), today);
  const [layers, setLayers] = useState<Layers>(readLayers);
  const [selectedSegment, setSelectedSegment] = useState<string | null>(null);

  const snapshot = useLiveQuery(() => loadTimeSnapshot(view, day), [view, day]);
  const fresh = snapshot?.view === view && snapshot.day === day ? snapshot : undefined;

  const update = (next: { view?: TimeView; day?: DayKey }): void => {
    const copy = new URLSearchParams(params);
    copy.set('tab', 'time');
    copy.set('view', next.view ?? view);
    copy.set('day', next.day ?? day);
    setParams(copy, { replace: true });
    setSelectedSegment(null);
  };

  const toggleLayer = (layer: Layer): void => {
    const next = { ...layers, [layer]: !layers[layer] };
    setLayers(next);
    writeLayers(next);
  };

  const model = useMemo(() => {
    if (!fresh) return undefined;
    const shown = periodRange(view, day);
    const trendRange = periodRange(trendPeriod(view), day);
    const cells = buildDayCells(fresh.captures, fresh.checkIns, layers);
    const trendCheckIns = fresh.checkIns.filter((c) => c.day >= trendRange.startDay && c.day <= trendRange.endDay);
    const trendCaptures = fresh.captures.filter((c) => c.day >= trendRange.startDay && c.day <= trendRange.endDay);
    return {
      shown,
      cells,
      summary: summarizePeriod(view, day, fresh.captures, fresh.checkIns, today),
      details: buildDayDetails(day, fresh.captures, fresh.checkIns, fresh.dayItems, fresh.commitments, fresh.patterns),
      trend: detectTrend(trendCheckIns, view),
      tags: topTags(trendCaptures, trendCheckIns),
      due: countDue(fresh.commitments, shown),
      seen: countPatternsSeen(fresh.patterns, shown),
    };
  }, [fresh, view, day, today, layers]);

  const size = breakpoint === 'phone' ? 340 : 400;

  return (
    <div className={styles.time}>
      <SegmentedControl
        aria-label={t('Period')}
        fullWidth
        value={view}
        onChange={(next) => update({ view: next })}
        options={TIME_VIEWS.map((value) => ({ value, label: VIEW_LABELS[value] }))}
      />

      <DayStrip day={day} today={today} cells={model?.cells ?? []} onSelect={(next) => update({ day: next })} />

      <div className={styles.layers} role="group" aria-label={t('Layers')}>
        {LAYERS.map((layer) => (
          <Chip key={layer} type={LAYER_TYPE[layer]} selected={layers[layer]} onClick={() => toggleLayer(layer)}>
            {LAYER_LABELS[layer]}
          </Chip>
        ))}
      </div>

      {!fresh || !model ? (
        <div aria-busy="true" className={styles.loading}>
          <Skeleton shape="circle" width={size - 40} height={size - 40} label={t('Loading')} />
          <Skeleton shape="block" height={72} />
        </div>
      ) : fresh.recordDays < 3 ? (
        <EmptyState
          illustration="ring"
          progress={{ value: fresh.recordDays, total: 3 }}
          title={emptyTimeTitle(view, fresh.recordDays)}
          description={t('Record at least once a day: the orbit will show how your days go. Days with records are marked on the strip above.')}
        />
      ) : (
        <>
          <TimeFigure
            view={view}
            day={day}
            today={today}
            minutes={minutes}
            cells={model.cells}
            summary={model.summary}
            details={model.details}
            layers={layers}
            size={size}
            selectedSegment={selectedSegment}
            onSelectSegment={setSelectedSegment}
            onSelectDay={(next) => update({ day: next })}
            onSelectView={(nextView, nextDay) => update({ view: nextView, ...(nextDay && { day: nextDay }) })}
            onShift={(delta) => update({ day: view === 'day' ? addDays(day, delta) : shiftPeriod(view, day, delta).startDay })}
          />

          {view !== 'day' ? <PeriodLine view={view} model={model} layers={layers} /> : null}

          <TrendBlock trend={model.trend} tags={model.tags} />

          <DayDetailsPanel details={model.details} layers={layers} today={today} highlightId={selectedSegment} />
        </>
      )}
    </div>
  );
}

function PeriodLine({
  view,
  model,
  layers,
}: {
  view: TimeView;
  model: { summary: ReturnType<typeof summarizePeriod>; due: number; seen: number };
  layers: Layers;
}) {
  const { summary, due, seen } = model;
  const parts: string[] = [];
  if (layers.records) parts.push(t('Days with records: {activeDays} of {elapsedDays}', { activeDays: summary.activeDays, elapsedDays: summary.elapsedDays }));
  if (layers.state) parts.push(summary.stateDays > 0 ? t('days with a state: {stateDays}', { stateDays: summary.stateDays }) : t('no state logged yet'));
  if (layers.commitments) parts.push(t('commitment deadlines: {due}', { due }));
  if (layers.patterns) parts.push(t('patterns visible: {seen}', { seen }));
  if (parts.length === 0) return <Body tone="muted">{t('Turn on a layer to see data.')}</Body>;
  const text = parts.join(' · ');
  return (
    <Caption className={cx(styles.periodLine)} as="p" aria-label={`${VIEW_LABELS[view]}: ${text}`}>
      {text}
    </Caption>
  );
}
