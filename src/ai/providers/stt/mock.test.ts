import { describe, expect, it, vi } from 'vitest';
import { AbortedError } from '../../errors';
import { t } from '../../../i18n';
import { MOCK_TRANSCRIPT, createMockStt } from './mock';

describe('mock STT', () => {
  it('returns the canned transcript and reports the duration', async () => {
    const onUsage = vi.fn();
    const result = await createMockStt({ onUsage }).transcribe(new Blob(['x']), { lang: 'ru', durationSec: 40 });
    expect(result).toEqual({ text: t(MOCK_TRANSCRIPT), durationSec: 40 });
    expect(onUsage).toHaveBeenCalledWith({ provider: 'mock', model: 'mock', audioSec: 40 });
  });

  it('can say something else and honors cancellation', async () => {
    expect((await createMockStt({ text: 'другое', durationSec: 5 }).transcribe(new Blob(['x']), { lang: 'ru' })).text).toBe('другое');
    const controller = new AbortController();
    controller.abort();
    await expect(createMockStt().transcribe(new Blob(['x']), { lang: 'ru', signal: controller.signal })).rejects.toBeInstanceOf(AbortedError);
  });
});
