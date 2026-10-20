import { useMemo } from 'react';
import type { MouseEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useCaptureCounts, useItems, usePatterns, useProfile } from '../../db/hooks';
import { addDays, formatDayShort, localDayKey, startOfWeek } from '../../domain/dates';
import { t } from '../../i18n';
import { objectsCount } from '../../domain/counts';
import type { IconName } from '../../ui';
import { Body, Caption, Display, Icon, Label, ListRow, ProgressRing, Skeleton, cx } from '../../ui';
import { MemorySheet } from './MemorySheet';
import { STREAK_WEEKS, avatarInitial, contextCompleteness, nextSteps, weekCells, weekStats } from './model';
import styles from './MeScreen.module.css';

interface LinkRowProps {
  icon: IconName;
  title: string;
  subtitle?: string;
  to?: string;
  onOpen(): void;
}

/** A row that is a real link (`#/…`) and still navigates inside the app. */
function LinkRow({ icon, title, subtitle, to, onOpen }: LinkRowProps) {
  return (
    <ListRow
      as="li"
      leading={
        <span className={styles.rowIcon} aria-hidden="true">
          <Icon name={icon} size={22} />
        </span>
      }
      title={title}
      subtitle={subtitle}
      href={to ? `#${to}` : undefined}
      onClick={(event: MouseEvent<HTMLElement>) => {
        event.preventDefault();
        onOpen();
      }}
    />
  );
}

/** «Я» (SPEC §4.14): the avatar with the «Контекст N %» ring, collections, memory, the year passport, weeks, settings. */
export default function MeScreen() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const memoryOpen = params.get('memory') === '1';

  const profile = useProfile();
  const facts = useItems({ kind: 'fact', status: 'active' });
  const patterns = usePatterns('confirmed');
  const allItems = useItems();

  const today = localDayKey();
  const firstWeek = addDays(startOfWeek(today), -7 * (STREAK_WEEKS - 1));
  const counts = useCaptureCounts(firstWeek, today);

  const currentFacts = useMemo(() => (facts ?? []).filter((fact) => fact.kind === 'fact' && !fact.supersededBy), [facts]);
  const completeness = useMemo(
    () => (profile ? contextCompleteness({ profile, factCount: currentFacts.length, confirmedPatternCount: patterns?.length ?? 0 }) : undefined),
    [profile, currentFacts, patterns],
  );
  const cells = useMemo(() => (counts ? weekCells(counts, today) : undefined), [counts, today]);
  const stats = useMemo(() => (cells ? weekStats(cells) : undefined), [cells]);
  const objectCount = (allItems ?? []).filter((item) => item.status === 'active' || item.status === 'done').length;

  const go = (path: string) => () => navigate(path);
  const setMemory = (open: boolean): void => {
    const next = new URLSearchParams(params);
    if (open) next.set('memory', '1');
    else next.delete('memory');
    setParams(next, { replace: !open });
  };

  if (!profile || !completeness) {
    return (
      <section className={styles.screen} aria-busy="true">
        <Skeleton shape="circle" width={120} height={120} label={t('Loading')} />
        <Skeleton shape="block" height={64} />
        <Skeleton shape="block" height={64} />
      </section>
    );
  }

  const steps = nextSteps(completeness);
  const name = profile.name.trim();

  return (
    <section className={styles.screen} aria-labelledby="me-title">
      <header className={styles.hero}>
        <ProgressRing
          value={completeness.percent / 100}
          size={128}
          stroke={5}
          label={t('Context')}
          valueText={`${completeness.percent} %`}
          className={styles.ring}
        >
          <span className={styles.avatar} aria-hidden="true">
            {avatarInitial(name)}
          </span>
        </ProgressRing>
        <Display as="h1" size="l" id="me-title" className={styles.name}>
          {name || t('Me')}
        </Display>
        <Label as="p" className={styles.context}>
          
          {t('Context {percent} %', { percent: completeness.percent })}
        
        </Label>
        <Caption className={styles.explain}>
          {t('How much the AI knows about you. Counted honestly: your name and four profile fields (10–20 % each), facts (up to 20 %) and confirmed patterns (up to 15 %). This is not a grade, just a hint about what to add.')}
        </Caption>
        {steps.length > 0 ? (
          <ul className={styles.steps} aria-label={t('What to add')}>
            {steps.map((part) => (
              <li key={part.id}>
                <button type="button" className={styles.step} onClick={() => setMemory(true)}>
                  <span className={styles.gain}>+{part.weight - part.earned} %</span>
                  <span>{part.label}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <Body tone="muted">{t('Profile and memory are filled in.')}</Body>
        )}
      </header>

      <ul className={styles.rows} aria-label={t('Sections')}>
        <LinkRow icon="project" title={t('Collections')} subtitle={t('{objects}: commitments, decisions, predictions…', { objects: objectsCount(objectCount) })} to="/items" onOpen={go('/items')} />
        <ListRow
          as="li"
          leading={
            <span className={styles.rowIcon} aria-hidden="true">
              <Icon name="fact" size={22} />
            </span>
          }
          title={t('Memory')}
          subtitle={t('What the AI knows: profile, facts, patterns')}
          onClick={() => setMemory(true)}
        />
        <LinkRow icon="review" title={t('Passport')} subtitle={t('Period summaries and the year in one card')} to="/reviews" onOpen={go('/reviews')} />
      </ul>

      <section className={styles.weeks} aria-labelledby="weeks-title">
        <h2 id="weeks-title" className={styles.weeksTitle}>
          <Label as="span" tone="strong">
            {t('Weekly streak')}
          </Label>
        </h2>
        {cells && stats ? (
          <>
            <ol className={styles.dots} aria-label={t('Last {STREAK_WEEKS} weeks, oldest to newest', { STREAK_WEEKS })}>
              {cells.map((cell) => (
                <li
                  key={cell.start}
                  className={cx(styles.dot, cell.has && styles.dotOn, cell.current && styles.dotNow)}
                  title={t('Week of {formatDayShort}: {v}', { formatDayShort: formatDayShort(cell.start), v: cell.has ? t('has records') : t('no records') })}
                >
                  <span className="sr-only">
                    
                    {t('Week of {formatDayShort}: {v}', { formatDayShort: formatDayShort(cell.start), v: cell.has ? t('has records') : t('no records') })}
                  </span>
                </li>
              ))}
            </ol>
            <Body>
              
              {t('Weeks with records: {withEntries} of {total}.{v}', { withEntries: stats.withEntries, total: stats.total, v: stats.run > 1 ? t(' In a row: {run}.', { run: stats.run }) : '' })}
            </Body>
            <Caption>{t('Just information. A missed week resets nothing and takes nothing away.')}</Caption>
          </>
        ) : (
          <Skeleton shape="block" height={48} />
        )}
      </section>

      <ul className={styles.rows} aria-label={t('Settings and helpers')}>
        <LinkRow icon="settings" title={t('Settings')} subtitle={t('AI, voice, theme, data and backup')} to="/settings" onOpen={go('/settings')} />
        <LinkRow icon="lock" title={t('Context for AI')} subtitle={t('Gather something to send to a chat')} to="/context" onOpen={go('/context')} />
        <LinkRow icon="ask" title={t('Ask')} subtitle={t('Ask your records a question')} to="/ask" onOpen={go('/ask')} />
      </ul>

      <MemorySheet open={memoryOpen} onClose={() => setMemory(false)} profile={profile} facts={currentFacts} patterns={patterns ?? []} />
    </section>
  );
}
