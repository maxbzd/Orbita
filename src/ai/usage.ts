import { usageRepo } from '../db';
import type { UsagePurpose } from '../domain/types';
import type { SttUsage, Usage } from './providers/types';

/** The default destination of token counts: the `usage` table (shown in Settings → Расход). */

export async function recordLlmUsage(usage: Usage, purpose: UsagePurpose): Promise<void> {
  await usageRepo.record({
    provider: usage.provider,
    model: usage.model,
    purpose,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    ...(usage.costUsd !== undefined && { costUsd: usage.costUsd }),
  });
}

export async function recordSttUsage(usage: SttUsage): Promise<void> {
  await usageRepo.record({
    provider: usage.provider,
    model: usage.model,
    purpose: 'transcribe',
    inputTokens: 0,
    outputTokens: 0,
    audioSec: usage.audioSec,
    ...(usage.costUsd !== undefined && { costUsd: usage.costUsd }),
  });
}
