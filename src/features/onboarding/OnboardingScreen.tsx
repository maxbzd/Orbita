import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { createLlmProvider, describeError } from '../../ai';
import { MicrophoneError, getMicrophoneAccess, probeMicrophone } from '../../audio';
import { capturesRepo, getSettings, mergeSettings, profileRepo, updateSettings } from '../../db';
import { useProfile } from '../../db/hooks';
import { seedDemo } from '../../db/seed';
import { nowISO } from '../../domain/dates';
import { useCloud } from '../../sync';
import { syncEnabled } from '../../sync/config';
import { CloudSignInForm } from '../settings/CloudSection';
import { processing } from '../../state/processing';
import {
  Body,
  Button,
  Caption,
  Chip,
  Display,
  Field,
  Heading,
  Icon,
  IconButton,
  Label,
  Orb,
  SegmentedControl,
  Sheet,
  TextArea,
  Thought,
  useAura,
  useHideNavigation,
  useToast,
} from '../../ui';
import { InterfaceLanguage } from '../settings/InterfaceLanguage';
import { KEY_PROVIDERS, NOT_DOING, OCCUPATIONS, aiSettingsPatch, profilePatch, trainerPhrase } from './logic';
import type { KeyProvider, Occupation } from './logic';
import styles from './Onboarding.module.css';
import { t } from '../../i18n';

const STEP_COUNT = 4;
type StepIndex = 0 | 1 | 2 | 3;

/** Marks the onboarding as done: the first-run redirect stops. */
async function markDone(): Promise<void> {
  await updateSettings({ onboarding: { done: true, completedAt: nowISO() } });
}

// ───────── 1. Splash ─────────

function Splash({ onNext, onRestored }: { onNext: () => void; onRestored: () => void }) {
  const [open, setOpen] = useState(false);
  const [signIn, setSignIn] = useState(false);
  const cloud = useCloud();

  // Signed in from here: once the first round is over, the data is on this device. With data, the introduction is not needed.
  useEffect(() => {
    if (!signIn || !cloud.userId || cloud.status !== 'idle' || cloud.lastSyncAt === null) return;
    setSignIn(false);
    if ((cloud.lastReport?.applied ?? 0) > 0) onRestored();
    else onNext();
  }, [signIn, cloud.userId, cloud.status, cloud.lastSyncAt, cloud.lastReport, onNext, onRestored]);

  return (
    <div className={styles.step}>
      <div className={styles.center}>
        <Orb state="idle" size={220} />
        <Display as="h1" size="xl" className={styles.headline}>
          {t("Speak. I'll sort it out.")}
        </Display>
        <Body tone="muted" className={styles.lead}>
          {t('Voice and thoughts turn into decisions, commitments and ideas. Everything stays on this device.')}
        </Body>
      </div>
      <div className={styles.actions}>
        <Button variant="primary" fullWidth onClick={onNext}>
          {t('Get started')}
        </Button>
        {syncEnabled() ? (
          <Button variant="ghost" onClick={() => setSignIn(true)}>
            {t('I already have an account')}
          </Button>
        ) : null}
        <Button variant="ghost" onClick={() => setOpen(true)}>
          {t("What I don't do")}
        </Button>
        <InterfaceLanguage size="sm" />
      </div>
      <Sheet open={signIn} onClose={() => setSignIn(false)} title={t('Sign in to the cloud')} snaps={[0.8]} defaultSnapIndex={0}>
        <CloudSignInForm />
      </Sheet>
      <Sheet open={open} onClose={() => setOpen(false)} title={t("What I don't do")} snaps={[0.55]} defaultSnapIndex={0}>
        <ul className={styles.notList}>
          {NOT_DOING.map((line) => (
            <li key={line}>
              <span className={styles.cross} aria-hidden="true">
                <Icon name="close" size={16} />
              </span>
              {t(line)}
            </li>
          ))}
        </ul>
      </Sheet>
    </div>
  );
}

// ───────── 2. Dialogue with the sphere ─────────

function Dialogue({ onNext }: { onNext: () => void }) {
  const profile = useProfile();
  const [name, setName] = useState('');
  const [occupation, setOccupation] = useState<Occupation | null>(null);
  const [other, setOther] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);

  // Someone who comes back to this screen sees what they typed before.
  useEffect(() => {
    if (profile && !touched) setName(profile.name);
  }, [profile, touched]);

  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      const patch = profilePatch({ name, occupation, other });
      if (Object.keys(patch).length > 0) await profileRepo.save(patch);
      onNext();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.step}>
      <div className={styles.dialogue}>
        <Orb state="idle" size={96} />
        <div className={styles.bubbles}>
          <div className={styles.bubble}>
            <Thought as="p">{t("Hi. What's your name?")}</Thought>
          </div>
          <Field
            label={t('Name', undefined, 'onboarding-screen')}
            value={name}
            autoComplete="given-name"
            enterKeyHint="next"
            placeholder={t('For example, Sam', undefined, 'onboarding-screen')}
            onChange={(event) => {
              setTouched(true);
              setName(event.target.value);
            }}
          />
          <div className={styles.bubble}>
            <Thought as="p">{t('What do you do?')}</Thought>
          </div>
          <div className={styles.chipRow} role="group" aria-label={t('What you do')}>
            {OCCUPATIONS.map((option) => (
              <Chip key={option.value} size="lg" selected={occupation === option.value} leading={occupation === option.value ? <Icon name="check" size={16} /> : undefined} onClick={() => setOccupation(option.value)}>
                {t(option.label)}
              </Chip>
            ))}
          </div>
          {occupation === 'other' ? (
            <Field label={t('Specifically')} value={other} placeholder={t('In one phrase')} onChange={(event) => setOther(event.target.value)} />
          ) : null}
        </div>
      </div>
      <div className={styles.actions}>
        <Button variant="primary" fullWidth loading={busy} onClick={() => void save()}>
          {t('Next')}
        </Button>
        <Caption>{t('Your name is only used for the greeting. You can skip it.')}</Caption>
      </div>
    </div>
  );
}

// ───────── 3. AI key and microphone ─────────

type Check = { state: 'idle' } | { state: 'running' } | { state: 'ok'; message: string } | { state: 'fail'; message: string };

function AiAndMicrophone({ onNext }: { onNext: () => void }) {
  const [provider, setProvider] = useState<KeyProvider>('anthropic');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [check, setCheck] = useState<Check>({ state: 'idle' });
  const [busy, setBusy] = useState(false);
  const [mic, setMic] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    void getSettings().then((settings) => setBaseUrl(settings.ai.openaiCompat.baseUrl));
    void getMicrophoneAccess().then((access) => {
      if (access === 'granted') setMic({ ok: true, message: t('Microphone access is already granted.') });
    });
  }, []);

  const hasKey = apiKey.trim() !== '';

  const test = async (): Promise<void> => {
    setCheck({ state: 'running' });
    try {
      const next = mergeSettings(await getSettings(), aiSettingsPatch({ provider, apiKey, baseUrl }));
      const result = await createLlmProvider(next).test();
      setCheck(result.ok ? { state: 'ok', message: result.message || t('Connection works.') } : { state: 'fail', message: result.message || t('Could not connect.') });
    } catch (error) {
      setCheck({ state: 'fail', message: describeError(error) });
    }
  };

  const saveAndNext = async (): Promise<void> => {
    setBusy(true);
    try {
      if (hasKey) await updateSettings(aiSettingsPatch({ provider, apiKey, baseUrl }));
      onNext();
    } finally {
      setBusy(false);
    }
  };

  const allowMic = async (): Promise<void> => {
    try {
      await probeMicrophone();
      setMic({ ok: true, message: t('Microphone allowed.') });
    } catch (error) {
      setMic({ ok: false, message: error instanceof MicrophoneError ? error.message : t('Could not open the microphone.') });
    }
  };

  return (
    <div className={styles.step}>
      <div className={styles.form}>
        <div>
          <Display as="h1" size="l" className={styles.title}>
            {t("Let's connect the AI")}
          </Display>
          <Body tone="muted">{t('A key is needed to sort records into objects. It is stored only on this device.')}</Body>
        </div>

        <SegmentedControl<KeyProvider> aria-label={t('AI provider')} options={KEY_PROVIDERS.map((option) => ({ ...option, label: t(option.label) }))} value={provider} onChange={(value) => { setProvider(value); setCheck({ state: 'idle' }); }} fullWidth />
        {provider === 'openai-compat' ? (
          <Field label={t('API address')} value={baseUrl} inputMode="url" autoCapitalize="off" spellCheck={false} onChange={(event) => setBaseUrl(event.target.value)} />
        ) : null}
        <Field
          label={t('API key')}
          type="password"
          value={apiKey}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder={provider === 'anthropic' ? 'sk-ant-…' : 'sk-…'}
          onChange={(event) => {
            setApiKey(event.target.value);
            setCheck({ state: 'idle' });
          }}
        />
        <div className={styles.inline}>
          <Button variant="secondary" size="sm" disabled={!hasKey} loading={check.state === 'running'} onClick={() => void test()}>
            {t('Test connection')}
          </Button>
          {check.state === 'ok' || check.state === 'fail' ? (
            <Caption role="status" className={check.state === 'ok' ? styles.ok : styles.fail}>
              {check.message}
            </Caption>
          ) : null}
        </div>

        <section className={styles.mic} aria-labelledby="onb-mic">
          <Heading as="h2" variant="headline" id="onb-mic">
            {t('Why the microphone')}
          </Heading>
          <Body tone="muted">
            {t('Voice recording starts with one tap. The browser will ask for access once. The recording and text stay on the device; only what you yourself send to the AI leaves it.')}
          </Body>
          <div className={styles.inline}>
            <Button variant="secondary" size="sm" iconStart="mic" onClick={() => void allowMic()}>
              {t('Allow microphone')}
            </Button>
            {mic ? (
              <Caption role="status" className={mic.ok ? styles.ok : styles.fail}>
                {mic.message}
              </Caption>
            ) : null}
          </div>
        </section>
      </div>

      <div className={styles.actions}>
        <Button variant="primary" fullWidth disabled={!hasKey} loading={busy} onClick={() => void saveAndNext()}>
          {t('Save and continue')}
        </Button>
        <Button variant="ghost" onClick={onNext}>
          {t('Not yet, without AI')}
        </Button>
        <Caption>{t('Records are saved without AI too. You can connect it later in settings.')}</Caption>
      </div>
    </div>
  );
}

// ───────── 4. Trainer ─────────

function Trainer({ onFinish }: { onFinish: (to: string, state?: unknown) => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [voiceOk, setVoiceOk] = useState<boolean | null>(null);
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<'save' | 'demo' | 'text' | null>(null);

  useEffect(() => {
    void getMicrophoneAccess().then((access) => {
      const available = access !== 'unsupported' && access !== 'denied';
      setVoiceOk(available);
      if (!available) setTyping(true);
    });
  }, []);

  const toCapture = async (): Promise<void> => {
    setBusy('save');
    try {
      await markDone();
      navigate(`/capture?hint=${encodeURIComponent(trainerPhrase())}`, { state: { hint: trainerPhrase() } });
    } finally {
      setBusy(null);
    }
  };

  const saveText = async (): Promise<void> => {
    const clean = text.trim();
    if (clean === '') return;
    setBusy('text');
    try {
      const capture = await capturesRepo.create({ kind: 'text', text: clean, status: 'transcribed' });
      await markDone();
      void processing.enqueue(capture.id);
      navigate(`/review/${capture.id}`, { replace: true });
    } catch {
      toast.show({ message: t('Could not save the record.'), tone: 'danger' });
      setBusy(null);
    }
  };

  const loadDemo = async (): Promise<void> => {
    setBusy('demo');
    try {
      await seedDemo();
      await markDone();
      toast.show({ message: t('Demo data loaded. You can remove it in Settings → Data.') });
      onFinish('/today');
    } catch {
      toast.show({ message: t('Could not load the demo data.'), tone: 'danger' });
      setBusy(null);
    }
  };

  const skip = async (): Promise<void> => {
    await markDone();
    onFinish('/today');
  };

  return (
    <div className={styles.step}>
      <div className={styles.form}>
        <div>
          <Label className={styles.kicker}>{t('First record')}</Label>
          <Display as="h1" size="l" className={styles.title}>
            {t("Let's try it in twenty seconds")}
          </Display>
          <Body tone="muted">{t("Say a phrase in your own words. I'll pull a decision out of it and show you how it looks.")}</Body>
        </div>

        <blockquote className={styles.phrase}>
          <Thought as="p" size="md" italic>
            «{trainerPhrase()}»
          </Thought>
        </blockquote>

        {typing ? (
          <>
            <TextArea
              label={t('Type instead')}
              value={text}
              rows={4}
              maxLength={2000}
              placeholder={trainerPhrase()}
              onChange={(event) => setText(event.target.value)}
              hint={voiceOk === false ? t('Voice recording is not available here, so use text.') : undefined}
            />
            <Button variant="primary" disabled={text.trim() === ''} loading={busy === 'text'} onClick={() => void saveText()}>
              {t('Save the record')}
            </Button>
          </>
        ) : (
          <div className={styles.inline}>
            <Button variant="primary" iconStart="mic" loading={busy === 'save'} onClick={() => void toCapture()}>
              {t('Record by voice')}
            </Button>
            <Button variant="ghost" iconStart="text" onClick={() => setTyping(true)}>
              {t('Write instead')}
            </Button>
          </div>
        )}
      </div>

      <div className={styles.actions}>
        <Button variant="secondary" fullWidth loading={busy === 'demo'} onClick={() => void loadDemo()}>
          {t('Load demo data')}
        </Button>
        <Button variant="ghost" onClick={() => void skip()}>
          {t('Skip')}
        </Button>
        <Caption>{t('Demo data brings every screen to life. You can delete it in settings.')}</Caption>
      </div>
    </div>
  );
}

// ───────── Screen ─────────

/**
 * Onboarding, four screens: the splash with "Чего я не делаю", the
 * dialogue with the sphere (name and occupation go to the profile), the AI key (or "Пока без ИИ") with the
 * microphone explained, and the trainer, the first record. `onboarding.done` is set when the user leaves.
 */
export default function OnboardingScreen() {
  useHideNavigation();
  useAura(0, 1);
  const navigate = useNavigate();
  const [step, setStep] = useState<StepIndex>(0);

  const toast = useToast();
  /** Data came down from the cloud: nothing left to introduce, go to the day. Keys never travel, so say so. */
  const restored = async (): Promise<void> => {
    await markDone();
    toast.show({ message: t('Your cloud data is here. The AI key is entered separately on each device: Settings → AI.'), duration: 8000 });
    navigate('/today', { replace: true });
  };

  const next = (): void => setStep((s) => (s < STEP_COUNT - 1 ? ((s + 1) as StepIndex) : s));
  const back = (): void => setStep((s) => (s > 0 ? ((s - 1) as StepIndex) : s));

  let body: ReactNode;
  switch (step) {
    case 0:
      body = <Splash onNext={next} onRestored={() => void restored()} />;
      break;
    case 1:
      body = <Dialogue onNext={next} />;
      break;
    case 2:
      body = <AiAndMicrophone onNext={next} />;
      break;
    default:
      body = <Trainer onFinish={(to) => navigate(to, { replace: true })} />;
  }

  return (
    <section className={styles.screen} aria-label={t('Getting started')}>
      <header className={styles.top}>
        {step > 0 ? <IconButton icon="chevron-left" label={t('Back')} onClick={back} /> : <span className={styles.spacer} />}
        <ol className={styles.dots} aria-label={t('Step {v} of {STEP_COUNT}', { v: step + 1, STEP_COUNT })}>
          {Array.from({ length: STEP_COUNT }, (_, i) => (
            <li key={i} className={styles.dot} data-active={i === step ? '' : undefined} data-done={i < step ? '' : undefined} />
          ))}
        </ol>
        <span className={styles.spacer} />
      </header>
      {body}
    </section>
  );
}
