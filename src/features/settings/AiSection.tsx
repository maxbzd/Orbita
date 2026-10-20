import { useState } from 'react';
import { createLlmProvider, describeError } from '../../ai';
import { getSettings, mergeSettings } from '../../db';
import type { SettingsPatch } from '../../db';
import { useSettings, useUsageSummary } from '../../db/hooks';
import { addDays, localDayKey } from '../../domain/dates';
import { formatTokens } from '../../domain/tokens';
import type { AiProviderId } from '../../domain/types';
import { Body, Button, Caption, Field, Mono, SegmentedControl, useToast } from '../../ui';
import { saveApiKeys } from '../lock';
import { Group, Row } from './Group';
import { SecretField } from './SecretField';
import {
  AI_PROVIDER_HINTS,
  AI_PROVIDER_LABELS,
  checkCsp,
  formatCost,
  readCspConnectOrigins,
  totalUsage,
} from './settingsModel';
import { useSaveSettings } from './useSaveSettings';
import styles from './Settings.module.css';
import { t } from '../../i18n';

const PROVIDER_OPTIONS = (['anthropic', 'openai-compat', 'manual'] as const).map((value) => ({ value, label: AI_PROVIDER_LABELS[value] }));

/** The explanation shown when the address is not on the list of the Content-Security-Policy. */
function CspNotice({ origin }: { origin: string }) {
  return (
    <div className={styles.notice} role="note">
      <strong>{t('The browser will block this address for now')}</strong>
      <p>
        {t('The app has a protective list of sites it may talk to at all, so that it never sends your records to a random foreign server. The list includes OpenAI, Anthropic, Groq and OpenRouter. Your server is not on it.')}
      </p>
      <p>
        {t("To make it work, add it once to the app's file")}{' '}<span className={styles.code}>index.html</span>{' '}{t(': find the line')}{' '}
        <span className={styles.code}>connect-src</span>{' '}{t('and append to its end, separated by a space:')}
      </p>
      <p className={styles.code}>{origin}</p>
      <p>{t('Then build and publish the app again. If you use a ready-made version and cannot change files, choose OpenAI, Groq or OpenRouter.')}</p>
    </div>
  );
}

function UsageBlock() {
  const today = localDayKey();
  const days = useUsageSummary(addDays(today, -13), today);
  if (!days) return null;
  if (days.length === 0) {
    return (
      <Row label={t('Token usage')}>
        <Body tone="muted">{t('No AI requests yet. Usage by day will appear here: how many tokens were used and roughly what that costs.')}</Body>
      </Row>
    );
  }
  const total = totalUsage(days);
  const recent = days.slice(-7).reverse();
  return (
    <Row label={t('Token usage over 14 days')} hint={t('The cost is an estimate from a built-in price table, not a bill from the provider.')}>
      <div className={styles.usage} role="table" aria-label={t('Token usage by day')}>
        <div className={styles.usageTotal} role="row">
          <Mono>{t('{formatTokens} tokens', { formatTokens: formatTokens(total.inputTokens + total.outputTokens) })}</Mono>
          <Mono>{formatCost(total.costUsd)}</Mono>
        </div>
        {recent.map((day) => (
          <div key={day.day} style={{ display: 'contents' }} role="row">
            <span className={styles.muted} role="cell">
              {day.day.slice(5).split('-').reverse().join('.')}
            </span>
            <span className={styles.num} role="cell">
              {formatTokens(day.inputTokens + day.outputTokens)}
            </span>
            <span className={`${styles.num} ${styles.muted}`} role="cell">
              {formatCost(day.costUsd)}
            </span>
          </div>
        ))}
      </div>
    </Row>
  );
}

export function AiSection() {
  const settings = useSettings();
  const save = useSaveSettings();
  const toast = useToast();
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  // Edits of text fields wait for blur; this keeps what is typed meanwhile.
  const [draft, setDraft] = useState<Record<string, string>>({});

  if (!settings) return null;
  const { ai } = settings;
  const provider = ai.provider;
  const isCompat = provider === 'openai-compat';
  const slot = isCompat ? ai.openaiCompat : ai.anthropic;
  const slotName = isCompat ? 'openaiCompat' : 'anthropic';

  const field = (name: string, stored: string): string => draft[name] ?? stored;
  const commit = (name: string, stored: string, patch: (value: string) => SettingsPatch): void => {
    const value = draft[name];
    if (value === undefined) return;
    setDraft(({ [name]: _gone, ...rest }) => rest);
    if (value.trim() !== stored) void save(patch(value.trim()));
  };

  const csp = isCompat ? checkCsp(ai.openaiCompat.baseUrl, readCspConnectOrigins()) : null;

  const runTest = async (): Promise<void> => {
    setTesting(true);
    setResult(null);
    try {
      const current = await getSettings();
      const live = mergeSettings(current, {
        ai: {
          provider,
          openaiCompat: { baseUrl: field('baseUrl', ai.openaiCompat.baseUrl).trim() || undefined },
        },
      });
      const outcome = await createLlmProvider(live).test();
      setResult(outcome);
    } catch (error) {
      setResult({ ok: false, message: describeError(error) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Group
      id="ai"
      title={t('AI')}
      footer={<p>{t('The key is stored only on this device. With the lock enabled it is also encrypted with your password.')}</p>}
    >
      <Row label={t('Provider')} hint={AI_PROVIDER_HINTS[provider]}>
        <SegmentedControl<AiProviderId>
          aria-label={t('AI provider')}
          options={PROVIDER_OPTIONS}
          value={provider}
          onChange={(value) => {
            setResult(null);
            void save({ ai: { provider: value } });
          }}
          fullWidth
        />
      </Row>

      {provider !== 'manual' ? (
        <>
          <SecretField
            key={slotName}
            label={isCompat ? t('API key') : t('Anthropic key')}
            value={slot.apiKey}
            onSave={async (value) => {
              await saveApiKeys(isCompat ? { openaiCompat: value } : { anthropic: value });
              setResult(null);
              toast.show({ message: value === '' ? t('Key removed') : t('Key saved'), duration: 2500 });
            }}
          />

          {isCompat ? (
            <div className={styles.row}>
              <Field
                label={t('Server address (baseUrl)')}
                type="url"
                inputMode="url"
                value={field('baseUrl', ai.openaiCompat.baseUrl)}
                onChange={(event) => setDraft((d) => ({ ...d, baseUrl: event.target.value }))}
                onBlur={() => commit('baseUrl', ai.openaiCompat.baseUrl, (value) => ({ ai: { openaiCompat: { baseUrl: value } } }))}
                autoCapitalize="none"
                spellCheck={false}
                error={csp?.status === 'invalid' ? csp.message : undefined}
                hint={t('For example https://api.groq.com/openai/v1')}
              />
            </div>
          ) : null}
          {csp?.status === 'blocked' ? <CspNotice origin={csp.origin} /> : null}

          <div className={styles.row}>
            <Field
              label={t('Fast model')}
              value={field(`${slotName}.fast`, slot.models.fast)}
              onChange={(event) => setDraft((d) => ({ ...d, [`${slotName}.fast`]: event.target.value }))}
              onBlur={() => commit(`${slotName}.fast`, slot.models.fast, (value) => ({ ai: { [slotName]: { models: { fast: value } } } }))}
              autoCapitalize="none"
              spellCheck={false}
              hint={t('Processing records and answering questions: cheap and quick.')}
            />
            <Field
              label={t('Smart model')}
              value={field(`${slotName}.smart`, slot.models.smart)}
              onChange={(event) => setDraft((d) => ({ ...d, [`${slotName}.smart`]: event.target.value }))}
              onBlur={() => commit(`${slotName}.smart`, slot.models.smart, (value) => ({ ai: { [slotName]: { models: { smart: value } } } }))}
              autoCapitalize="none"
              spellCheck={false}
              hint={t('Weekly reviews and pattern search: quality matters more here.')}
            />
          </div>
        </>
      ) : null}

      <Row>
        <div className={styles.inline}>
          <Button variant="secondary" size="sm" loading={testing} onClick={() => void runTest()}>
            {t('Test connection')}
          </Button>
        </div>
        {result ? (
          <p className={`${styles.result} ${result.ok ? styles.resultOk : styles.resultBad}`} role="status">
            {result.message}
          </p>
        ) : (
          <Caption tone="faint">{t('We will send a tiny request to make sure the key and address are correct.')}</Caption>
        )}
      </Row>

      <UsageBlock />
    </Group>
  );
}
