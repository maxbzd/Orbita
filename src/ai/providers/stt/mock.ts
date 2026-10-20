import { msg, t } from '../../../i18n';
import { AbortedError } from '../../errors';
import { sleep } from '../../http';
import { reportSttUsage } from '../shared';
import type { SttProvider, SttUsageSink } from '../types';

/** What the mock "hears" unless told otherwise: a short note with a decision, a promise and a task. */
/** An i18n key: the text is the English one, `t(MOCK_TRANSCRIPT)` gives the transcript in the current language. */
export const MOCK_TRANSCRIPT = msg('Today I decided to raise the price of the trial session to 700. I promised Masha to send the plan by Friday. I need to call Pete tomorrow.');

export interface MockSttConfig {
  text?: string;
  durationSec?: number;
  delayMs?: number;
  onUsage?: SttUsageSink;
}

/** Deterministic speech recognition for tests and `VITE_MOCK_AI=1`. */
export function createMockStt(config: MockSttConfig = {}): SttProvider {
  return {
    id: 'mock',
    async transcribe(_blob, options) {
      if (options.signal?.aborted) throw new AbortedError();
      if ((config.delayMs ?? 0) > 0) await sleep(config.delayMs ?? 0, options.signal);
      const durationSec = config.durationSec ?? options.durationSec ?? 12;
      await reportSttUsage(config.onUsage, { provider: 'mock', model: 'mock', audioSec: durationSec });
      return { text: config.text ?? t(MOCK_TRANSCRIPT), durationSec };
    },
  };
}
