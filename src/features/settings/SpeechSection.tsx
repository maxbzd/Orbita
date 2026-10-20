import { useState } from 'react';
import { isBrowserSpeechAvailable } from '../../ai';
import { useSettings } from '../../db/hooks';
import type { SttProviderId } from '../../domain/types';
import { Field, SegmentedControl, useToast } from '../../ui';
import { saveApiKeys } from '../lock';
import { Group, Row } from './Group';
import { SecretField } from './SecretField';
import { STT_PROVIDER_LABELS } from './settingsModel';
import { useSaveSettings } from './useSaveSettings';
import styles from './Settings.module.css';
import { t } from '../../i18n';

const OPTIONS = (['browser', 'openai-compat'] as const).map((value) => ({ value, label: STT_PROVIDER_LABELS[value] }));

export function SpeechSection() {
  const settings = useSettings();
  const save = useSaveSettings();
  const toast = useToast();
  const [draft, setDraft] = useState<Record<string, string>>({});
  if (!settings) return null;
  const { stt } = settings;
  const browser = stt.provider === 'browser';

  const field = (name: keyof typeof stt, stored: string): string => draft[name] ?? stored;
  const bind = (name: 'baseUrl' | 'model') => ({
    value: field(name, stt[name]),
    onChange: (event: { target: { value: string } }) => setDraft((d) => ({ ...d, [name]: event.target.value })),
    onBlur: () => {
      const value = draft[name]?.trim();
      setDraft(({ [name]: _gone, ...rest }) => rest);
      if (value !== undefined && value !== stt[name]) void save({ stt: { [name]: value } });
    },
    autoCapitalize: 'none' as const,
    spellCheck: false,
  });

  return (
    <Group
      id="speech"
      title={t('Speech recognition')}
      footer={
        <p>
          {t('Voice recordings are always saved on the device. Recognition turns them into text: the browser does it itself and right away, an external service does it after the recording, costs more, but is more accurate on long monologues.')}
        </p>
      }
    >
      <Row
        label={t('Recognise with')}
        hint={
          browser
            ? isBrowserSpeechAvailable()
              ? t('Live dictation right while recording: text appears as you speak. Free.')
              : t('This browser has no live dictation (it is usually available in Chrome and Edge). The recording is still saved, and you can type the text or choose an external service.')
            : t('The recording goes to an OpenAI-compatible server (/audio/transcriptions) and comes back as text.')
        }
      >
        <SegmentedControl<SttProviderId>
          aria-label={t('Speech recognition')}
          options={OPTIONS}
          value={stt.provider}
          onChange={(value) => void save({ stt: { provider: value } })}
          fullWidth
        />
      </Row>
      {!browser ? (
        <>
          <div className={styles.row}>
            <Field label={t('Server address')} type="url" inputMode="url" {...bind('baseUrl')} hint={t('For example https://api.openai.com/v1')} />
            <Field label={t('Model')} {...bind('model')} hint="whisper-1, gpt-4o-transcribe, whisper-large-v3-turbo (Groq)" />
          </div>
          <SecretField
            label={t('Recognition key')}
            value={stt.apiKey}
            hint={t('You can leave it empty if the address is the same as the AI one above: then its key is used. Your key never goes to a different server.')}
            onSave={async (value) => {
              await saveApiKeys({ stt: value });
              toast.show({ message: value === '' ? t('Key removed') : t('Key saved'), duration: 2500 });
            }}
          />
        </>
      ) : null}
    </Group>
  );
}
