import { useSettings } from '../../db/hooks';
import { CAPTURE_CONTEXTS, PRIVACY_LEVELS } from '../../domain/types';
import type { CaptureContext, PrivacyLevel } from '../../domain/types';
import { Chip, SegmentedControl, Toggle } from '../../ui';
import { Group, Row } from './Group';
import { AUTO_ACCEPT_STEPS, CONTEXT_LABELS, PRIVACY_HINTS, PRIVACY_LABELS, nearestAutoAcceptStep } from './settingsModel';
import { useSaveSettings } from './useSaveSettings';
import styles from './Settings.module.css';
import { t } from '../../i18n';

/** «Захват» and «Приватность»: what happens when a record is made and what may leave the device. */
export function CaptureSection() {
  const settings = useSettings();
  const save = useSaveSettings();
  if (!settings) return null;
  const { capture, autoAccept, privacy } = settings;
  const step = nearestAutoAcceptStep(autoAccept.minConfidence);

  return (
    <>
      <Group id="capture" title={t('Capture')}>
        <Row label={t('Default context')} hint={t('The chip on the recording screen will already be selected. You can always change it before recording.')}>
          <div className={styles.chips} role="group" aria-label={t('Default context')}>
            <Chip selected={capture.defaultContext === null} onClick={() => void save({ capture: { defaultContext: null } })}>
              {t('Do not select')}
            </Chip>
            {CAPTURE_CONTEXTS.filter((context): context is CaptureContext => context !== 'other').map((context) => (
              <Chip key={context} selected={capture.defaultContext === context} onClick={() => void save({ capture: { defaultContext: context } })}>
                {CONTEXT_LABELS[context]}
              </Chip>
            ))}
          </div>
        </Row>
        <Toggle
          label={t('Keep audio')}
          description={t('Voice is saved next to the text, and you can return to it. Turn it off if you only need text: it takes less space.')}
          checked={capture.keepAudio}
          onChange={(checked) => void save({ capture: { keepAudio: checked } })}
        />
        <Toggle
          label={t('Walk mode')}
          description={t('During a long recording the screen dims so it does not distract and saves battery. A touch wakes it. Recording does not stop.')}
          checked={capture.walkMode}
          onChange={(checked) => void save({ capture: { walkMode: checked } })}
        />
        <Toggle
          label={t('Accept confident ones automatically')}
          description={t('Objects the AI is at least this sure of go into your lists without confirmation. The rest waits for review.')}
          checked={autoAccept.enabled}
          onChange={(checked) => void save({ autoAccept: { enabled: checked } })}
        />
        {autoAccept.enabled ? (
          <Row label={t('Confidence threshold')} hint={t('The higher the threshold, the less is accepted on its own. We recommend 85 % or higher.')}>
            <SegmentedControl<string>
              aria-label={t('Confidence threshold')}
              options={AUTO_ACCEPT_STEPS.map((value) => ({ value: String(value), label: `${Math.round(value * 100)}%` }))}
              value={String(step)}
              onChange={(value) => void save({ autoAccept: { minConfidence: Number(value) } })}
              fullWidth
            />
          </Row>
        ) : null}
      </Group>

      <Group
        id="privacy"
        title={t('Privacy')}
        footer={
          <>
            <p>{t('Everything is stored on this device. Only what you yourself send to your AI provider leaves it, and only with your key.')}</p>
            <p>{t('The app has no analytics and no third-party servers.')}</p>
          </>
        }
      >
        <Row label={t('Names in the AI context')} hint={PRIVACY_HINTS[privacy.contextLevel]}>
          <SegmentedControl<PrivacyLevel>
            aria-label={t('Names in the AI context')}
            options={PRIVACY_LEVELS.map((value) => ({ value, label: PRIVACY_LABELS[value] }))}
            value={privacy.contextLevel}
            onChange={(value) => void save({ privacy: { contextLevel: value } })}
            fullWidth
          />
        </Row>
        <Toggle
          label={t('Show what the AI will receive')}
          description={t('Before a request is sent you can see the text the provider will get.')}
          checked={privacy.previewBeforeSend}
          onChange={(checked) => void save({ privacy: { previewBeforeSend: checked } })}
        />
      </Group>
    </>
  );
}
