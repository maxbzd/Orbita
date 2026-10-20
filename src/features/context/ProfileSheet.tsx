import { useEffect, useState } from 'react';
import { profileRepo } from '../../db';
import { useProfile } from '../../db/hooks';
import { Body, Button, Sheet, TextArea, Field, useToast } from '../../ui';
import styles from './Context.module.css';
import { t } from '../../i18n';

interface Draft {
  name: string;
  about: string;
  goals: string;
  values: string;
  talkStyle: string;
}

const EMPTY: Draft = { name: '', about: '', goals: '', values: '', talkStyle: '' };

/** Editing «Кто я»: the part of the context every chat gets first. */
export function ProfileSheet({ open, onClose }: { open: boolean; onClose(): void }) {
  const profile = useProfile();
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open && profile) setDraft({ name: profile.name, about: profile.about, goals: profile.goals, values: profile.values, talkStyle: profile.talkStyle });
    // Loaded again each time the sheet opens, not on every keystroke elsewhere.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const set = (key: keyof Draft) => (event: { target: { value: string } }) => setDraft((d) => ({ ...d, [key]: event.target.value }));

  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      await profileRepo.save(draft);
      toast.show({ message: t('Profile saved'), duration: 2000 });
      onClose();
    } catch {
      toast.show({ message: t('Could not save the profile.'), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={t('Who I am')} placement="sheet" snaps={[0.92]}>
      <form
        className={styles.sheetBody}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Body tone="muted">{t('This goes at the start of every context. Keep it short and to the point, as if telling a new mentor.')}</Body>
        <Field label={t('Name', undefined, 'profile-sheet')} value={draft.name} onChange={set('name')} autoComplete="off" />
        <TextArea label={t('What I do')} value={draft.about} onChange={set('about')} rows={3} placeholder={t('Product designer, building a side project')} />
        <TextArea label={t('Goals')} value={draft.goals} onChange={set('goals')} rows={3} placeholder={t('Ship the first version by summer')} />
        <TextArea label={t('Values')} value={draft.values} onChange={set('values')} rows={2} placeholder={t('Honesty, quality, freedom')} />
        <TextArea label={t('How to talk to me')} value={draft.talkStyle} onChange={set('talkStyle')} rows={2} placeholder={t('Briefly, no fluff, with concrete steps')} />
        <Button type="submit" variant="primary" fullWidth loading={busy}>
          {t('Save')}
        </Button>
      </form>
    </Sheet>
  );
}
