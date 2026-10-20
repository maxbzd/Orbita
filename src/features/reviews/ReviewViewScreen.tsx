import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { usePeople } from '../../db/hooks';
import { loadItalicFonts, loadPosterFont } from '../../styles/fonts';
import { Body, Button, Caption, Dialog, Display, EmptyState, Icon, Label, Skeleton, StoryViewer, Toggle, saveAsImage, useToast } from '../../ui';
import type { StoryExportInfo, StorySlide } from '../../ui';
import { makeReview } from './actions';
import { exportFontCss } from './fontCss';
import { useAiReadyForReviews, useReviewById, useSlideContext } from './hooks';
import { PERIOD_LABEL, buildSlides, maskSlide, reviewNames, reviewTitle, slideHasNames } from './model';
import { QuestionsBlock } from './QuestionsBlock';
import { SlideView } from './slides';
import styles from './Reviews.module.css';
import { t } from '../../i18n';

const HIDE_NAMES_KEY = 'orbit.reviews.hideNames';

function readHideNames(): boolean {
  try {
    return window.localStorage.getItem(HIDE_NAMES_KEY) === '1';
  } catch {
    return false;
  }
}

function writeHideNames(value: boolean): void {
  try {
    window.localStorage.setItem(HIDE_NAMES_KEY, value ? '1' : '0');
  } catch {
    /* a private window: the choice lives until the page is closed */
  }
}

const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

/**
 * `/reviews/:reviewId`: the review as a 9:16 story with the reflection questions beside
 * or under it. Slides are SVG objects, so "Сохранить картинку" exports exactly what is shown; "Скрыть имена" masks people
 * on the slides, and the export offers it when a slide shows a name.
 */
export default function ReviewViewScreen() {
  const { reviewId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const review = useReviewById(reviewId);
  const context = useSlideContext(review);
  const people = usePeople({ includeArchived: true });
  const aiReady = useAiReadyForReviews();
  const [hideNames, setHideNames] = useState(readHideNames);
  const [typing, setTyping] = useState(false);
  const [pending, setPending] = useState<StoryExportInfo | null>(null);
  const [exporting, setExporting] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);

  useEffect(() => {
    void loadPosterFont();
    void loadItalicFonts();
  }, []);

  const specs = useMemo(() => (review && context ? buildSlides(review, context) : []), [review, context]);
  const names = useMemo(() => (review ? reviewNames(review, people ?? []) : []), [review, people]);
  const shown = useMemo(() => (hideNames ? specs.map((spec) => maskSlide(spec, names)) : specs), [hideNames, specs, names]);
  const slides = useMemo<StorySlide[]>(() => shown.map((spec) => ({ id: spec.id, label: spec.label, content: <SlideView spec={spec} /> })), [shown]);

  const changeHideNames = useCallback((value: boolean) => {
    setHideNames(value);
    writeHideNames(value);
  }, []);

  const runExport = useCallback(
    async (info: StoryExportInfo): Promise<void> => {
      if (!review) return;
      setExporting(true);
      try {
        const fontCss = await exportFontCss(info.element);
        await saveAsImage(info.element, `orbita-${review.period}-${review.startDay}-${info.index + 1}.png`, { fontCss, scale: 3 });
        toast.show({ message: t('Image saved.') });
      } catch {
        toast.show({ message: t('Could not save the image. Try again.'), tone: 'danger' });
      } finally {
        setExporting(false);
      }
    },
    [review, toast],
  );

  const onExport = useCallback(
    (info: StoryExportInfo): void => {
      const spec = specs[info.index];
      // Names are checked on the unmasked slide: when the toggle is on, the slide shown has none left.
      if (!hideNames && spec && slideHasNames(spec, names)) setPending(info);
      else void runExport(info);
    },
    [hideNames, names, runExport, specs],
  );

  const exportMasked = async (): Promise<void> => {
    const info = pending;
    setPending(null);
    if (!info) return;
    changeHideNames(true);
    // The slide re-renders with the masks; the same element is exported after it has been painted.
    await nextFrame();
    await nextFrame();
    await runExport(info);
  };

  const exportAsIs = (): void => {
    const info = pending;
    setPending(null);
    if (info) void runExport(info);
  };

  const rebuild = async (): Promise<void> => {
    if (!review || rebuilding) return;
    setRebuilding(true);
    try {
      const result = await makeReview(review.period, review.startDay);
      toast.show({ message: result.aiError ? t('The AI did not answer, the review was built by rules. Your answers are intact.') : t('The review was rebuilt. Your answers are intact.') });
    } catch {
      toast.show({ message: t('Could not rebuild the review. The old one is intact.'), tone: 'danger' });
    } finally {
      setRebuilding(false);
    }
  };

  const toQuestions = useCallback(() => {
    const field = document.getElementById('review-q-0');
    const target = field ?? document.getElementById('review-questions-block');
    target?.scrollIntoView({ block: 'center' });
    (field as HTMLElement | null)?.focus({ preventScroll: true });
  }, []);

  if (review === undefined || (review && !context)) {
    return (
      <section className={styles.screen} aria-busy="true" aria-label={t('The review is loading')}>
        <Skeleton height={32} width="60%" />
        <Skeleton height={420} />
      </section>
    );
  }
  if (review === null) {
    return (
      <section className={styles.screen}>
        <EmptyState
          title={t('No such review')}
          description={t('It may have been deleted. Your other reviews are intact.')}
          action={
            <Button variant="primary" onClick={() => navigate('/reviews')}>
              {t('To reviews')}
            </Button>
          }
        />
      </section>
    );
  }

  return (
    <section className={styles.screen} aria-labelledby="review-title">
      <header className={styles.viewHead}>
        <Link to="/reviews" className={styles.back}>
          <Icon name="chevron-left" size={18} />
          {t('Reviews')}
        </Link>
        <Label as="p">{PERIOD_LABEL[review.period]}</Label>
        <Display as="h1" size="l" id="review-title">
          {reviewTitle(review)}
        </Display>
      </header>

      <div className={styles.viewBody}>
        <StoryViewer
          className={styles.story}
          slides={slides}
          label={t('Review: {reviewTitle}', { reviewTitle: reviewTitle(review) })}
          autoAdvance={!typing && pending === null && !exporting}
          onClose={() => navigate('/reviews')}
          onFinish={toQuestions}
          onExport={onExport}
        />

        <div className={styles.side}>
          <Toggle
            checked={hideNames}
            onChange={changeHideNames}
            label={t('Hide names')}
            description={names.length ? t('On images and slides people will become “•••”. The normal view in Reviews does not change.') : t("There are no people's names in this review.")}
          />
          <QuestionsBlock review={review} onTypingChange={setTyping} />

          <details className={styles.fullText}>
            <summary>{t('Full text of the review')}</summary>
            <Body as="p" tone="muted">
              {review.headline}
            </Body>
            {review.sections.map((section) => (
              <section key={section.id} className={styles.textSection}>
                <Label as="h3">{section.title}</Label>
                <Body as="p" className={styles.preLine}>
                  {section.body}
                </Body>
              </section>
            ))}
          </details>

          <div className={styles.sideFoot}>
            <Caption tone="faint">
              {review.generatedBy === 'ai'
                ? t('The text was written with the help of AI, the numbers are counted from your records. AI can be wrong.')
                : aiReady
                  ? t('Built by rules. You can rebuild it with AI.')
                  : t('Built by rules, without AI. Add a key in Settings → AI.')}
            </Caption>
            <Button size="sm" variant="secondary" loading={rebuilding} onClick={() => void rebuild()}>
              {t('Rebuild')}
            </Button>
          </div>
        </div>
      </div>

      <Dialog
        open={pending !== null}
        onClose={() => setPending(null)}
        title={t('Hide names before saving?')}
        description={t("This slide has people's names. An image is easy to forward, and others would see them.")}
        role="alertdialog"
        size="sm"
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={() => setPending(null)}>
              {t('Cancel', undefined, 'review-view-screen')}
            </Button>
            <Button variant="secondary" size="sm" onClick={exportAsIs}>
              {t('Save as is')}
            </Button>
            <Button variant="primary" size="sm" onClick={() => void exportMasked()} data-autofocus="">
              {t('Hide names and save')}
            </Button>
          </>
        }
      />
    </section>
  );
}
