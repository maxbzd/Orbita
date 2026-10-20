import { describe, expect, it } from 'vitest';
import { stepsFor } from './ProcessingView';

const states = (stage: Parameters<typeof stepsFor>[0], hasAudio: boolean, hasText: boolean) => stepsFor(stage, hasAudio, hasText).map((s) => `${s.id}:${s.state}`);

describe('the honest step list', () => {
  it('a typed note is saved and structured: two steps, no transcription it never had', () => {
    expect(states('saving', false, true)).toEqual(['saving:active', 'extracting:todo']);
    expect(states('extracting', false, true)).toEqual(['saving:done', 'extracting:active']);
    expect(states('queued', false, true)).toEqual(['saving:done', 'extracting:active']);
  });

  it('a recording without text is transcribed first', () => {
    expect(states('saving', true, false)).toEqual(['saving:active', 'transcribing:todo', 'extracting:todo']);
    expect(states('transcribing', true, false)).toEqual(['saving:done', 'transcribing:active', 'extracting:todo']);
    expect(states('extracting', true, false)).toEqual(['saving:done', 'transcribing:done', 'extracting:active']);
    expect(states('queued', true, false)).toEqual(['saving:done', 'transcribing:active', 'extracting:todo']);
  });

  it('a recording that was dictated already has its text: no transcription step', () => {
    expect(states('extracting', true, true)).toEqual(['saving:done', 'extracting:active']);
  });
});
