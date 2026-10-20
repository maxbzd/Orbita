import type { ProcessOutcome } from '../../ai';
import { processing } from '../../state/processing';
import type { Job } from '../../state/processing';
import type { ID } from '../../domain/types';
import { t } from '../../i18n';

export type ProcessingResult = { ok: true; outcome: ProcessOutcome } | { ok: false; message: string };

/** The Job of the shared processing service as something a toast can say. */
export function describeJob(job: Job): ProcessingResult {
  if (job.stage === 'done') return { ok: true, outcome: job.result?.outcome ?? 'done' };
  return { ok: false, message: job.message ?? (job.stage === 'waiting' ? t('The record is waiting: check your AI key and connection.') : t('Could not process the record.')) };
}

/**
 * Runs the whole pipeline for a record through the app's processing service (transcribe if needed → extract →
 * review). Used by "Разобрать", "Повторить" and "Перепрогнать обработку". Never throws: the reason comes back
 * as Russian text for a toast. Without a key nothing is lost, the record just stays where it was.
 */
export async function runProcessing(captureId: ID): Promise<ProcessingResult> {
  return describeJob(await processing.enqueue(captureId));
}

/** What to tell the user after a successful run. */
export function outcomeMessage(outcome: ProcessOutcome): string {
  switch (outcome) {
    case 'review':
      return t('Done: the objects await confirmation.');
    case 'done':
      return t('Done.');
    case 'skipped':
      return t('There is nothing to process in the record.');
    case 'waiting':
      return t('The record is waiting for speech recognition.');
  }
}
