import { lazy, Suspense } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Display, SegmentedControl, Skeleton } from '../../ui';
import { PatternsView } from '../patterns/PatternsView';
import { PeopleView } from '../people/PeopleView';
import { TAB_LABELS, TABS, parseTab } from './model';
import type { OrbitTab } from './model';
import styles from './Orbit.module.css';
import { t } from '../../i18n';

const TimeTab = lazy(async () => ({ default: (await import('./TimeTab')).TimeTab }));

/**
 * «Орбита» (SPEC §4.7, §4.9, §4.10): the segments «Время · Люди · Паттерны». The segment is in the URL
 * (`/orbit?tab=people`); `/people` and `/patterns` open the same screen on their segment, so the desktop
 * sidebar entries keep working.
 */
export function OrbitScreen({ fixedTab }: { fixedTab?: OrbitTab }) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const tab = fixedTab ?? parseTab(params.get('tab'));

  const choose = (next: OrbitTab): void => {
    if (fixedTab) {
      navigate(`/orbit?tab=${next}`, { replace: true });
      return;
    }
    // The time view keeps its own parameters only on its own segment.
    setParams(next === 'time' ? { tab: next, ...(params.get('view') && { view: params.get('view')! }), ...(params.get('day') && { day: params.get('day')! }) } : { tab: next }, { replace: true });
  };

  return (
    <section className={styles.screen} aria-labelledby="orbit-title">
      <header className={styles.head}>
        <Display as="h1" size="l" id="orbit-title">
          {TAB_LABELS[tab]}
        </Display>
        <SegmentedControl
          aria-label={t('Orbit section')}
          fullWidth
          value={tab}
          onChange={choose}
          options={TABS.map((value) => ({ value, label: TAB_LABELS[value] }))}
        />
      </header>
      {tab === 'time' ? (
        <Suspense fallback={<Skeleton shape="block" height={320} label={t('Loading')} />}>
          <TimeTab />
        </Suspense>
      ) : tab === 'people' ? (
        <PeopleView />
      ) : (
        <PatternsView />
      )}
    </section>
  );
}

export default OrbitScreen;
