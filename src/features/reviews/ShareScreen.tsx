import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { capturesRepo } from '../../db';
import { processing } from '../../state';
import { Body, Button, Caption, Display, EmptyState, Heading, Label, TextArea, useToast } from '../../ui';
import { SHARE_LIMITS, parseShare, shareToCapture } from './share';
import styles from './Reviews.module.css';
import { t } from '../../i18n';

/** Removes `?title=…&text=…` from the address, so a reload or a restored tab does not offer the same share again. */
function forgetQuery(): void {
  try {
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.hash}`);
  } catch {
    /* an embedded frame may forbid it */
  }
}

/**
 * `/share`: the Android "Поделиться" target. The browser appends `?title=&text=&url=` before `#/share`, so the query is read
 * from `window.location.search` (and, as a fallback, from the hash's own query). Nothing is saved until the person confirms:
 * the text is shown (and editable) first, and it is only ever treated as text.
 */
export default function ShareScreen() {
  const navigate = useNavigate();
  const toast = useToast();
  const [hashParams] = useSearchParams();
  // Read once: the address is cleaned after saving, and typing must not re-read it.
  const shared = useMemo(() => parseShare(window.location.search, hashParams), [hashParams]);
  const [text, setText] = useState(shared?.text ?? '');
  const [busy, setBusy] = useState<'save' | 'process' | null>(null);
  const clean = text.trim();

  const save = async (process: boolean): Promise<void> => {
    if (!shared || clean === '' || busy) return;
    setBusy(process ? 'process' : 'save');
    try {
      const capture = await capturesRepo.create(shareToCapture(shared, text));
      forgetQuery();
      if (process) {
        void processing.enqueue(capture.id);
        navigate(`/review/${capture.id}`, { replace: true });
      } else {
        toast.show({ message: t('Saved in the Stream. You can process it later.') });
        navigate(`/entry/${capture.id}`, { replace: true });
      }
    } catch {
      toast.show({ message: t('Could not save. The text stayed in the field.'), tone: 'danger' });
      setBusy(null);
    }
  };

  const cancel = (): void => {
    forgetQuery();
    navigate('/today', { replace: true });
  };

  if (!shared) {
    return (
      <section className={styles.screen} aria-labelledby="share-title">
        <Display as="h1" size="l" id="share-title">
          {t('Share')}
        </Display>
        <EmptyState
          title={t('What you share from other apps arrives here.')}
          description={t('Choose “Orbita” in the Share menu of a link, note or chat. Nothing has arrived yet.')}
          action={
            <Button variant="primary" onClick={() => navigate('/capture')}>
              {t('Write down a thought')}
            </Button>
          }
        />
      </section>
    );
  }

  return (
    <section className={styles.screen} aria-labelledby="share-title">
      <header className={styles.listHead}>
        <Label as="p">{t('Share')}</Label>
        <Display as="h1" size="l" id="share-title">
          {t('Save to Orbita?')}
        </Display>
        <Caption>{t('Nothing is sent or saved until you press the button.')}</Caption>
      </header>

      {shared.title ? (
        <Heading as="h2" variant="headline">
          {shared.title}
        </Heading>
      ) : null}
      <TextArea
        label={t('Record text')}
        hint={shared.url ? t('The link will be saved with the record: {url}', { url: shared.url }) : t('You can edit it before saving.')}
        value={text}
        rows={8}
        autoGrow
        maxRows={16}
        maxLength={SHARE_LIMITS.text}
        onChange={(event) => setText(event.target.value)}
      />

      <div className={styles.shareActions}>
        <Button variant="primary" fullWidth loading={busy === 'process'} disabled={clean === '' || busy !== null} onClick={() => void save(true)}>
          {t('Save and process')}
        </Button>
        <Button variant="secondary" fullWidth loading={busy === 'save'} disabled={clean === '' || busy !== null} onClick={() => void save(false)}>
          {t('Just save')}
        </Button>
        <Button variant="ghost" fullWidth disabled={busy !== null} onClick={cancel}>
          {t("Don't save")}
        </Button>
      </div>
      <Body tone="muted">{t('Processing will pull decisions, promises and ideas out of the text. If no AI is connected, the record waits in the Stream.')}</Body>
    </section>
  );
}
