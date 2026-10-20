import { describe, expect, it } from 'vitest';
import { RECORDING_MIME_CANDIDATES, audioExtension, baseMime, pickRecordingMime } from './mime';

const supporting = (...supported: string[]) => (mime: string) => supported.includes(mime);

describe('pickRecordingMime', () => {
  it('prefers WebM/Opus where the browser has it (Chrome, Firefox, Android)', () => {
    expect(pickRecordingMime(supporting(...RECORDING_MIME_CANDIDATES))).toBe('audio/webm;codecs=opus');
  });

  it('falls back to MP4/AAC on Safari, which cannot record WebM', () => {
    expect(pickRecordingMime(supporting('audio/mp4'))).toBe('audio/mp4');
    expect(pickRecordingMime(supporting('audio/mp4', 'audio/mp4;codecs=mp4a.40.2'))).toBe('audio/mp4;codecs=mp4a.40.2');
  });

  it('takes plain WebM when the codec cannot be named, and Ogg as the last resort', () => {
    expect(pickRecordingMime(supporting('audio/webm', 'audio/ogg'))).toBe('audio/webm');
    expect(pickRecordingMime(supporting('audio/ogg;codecs=opus'))).toBe('audio/ogg;codecs=opus');
    expect(pickRecordingMime(supporting('audio/ogg'))).toBe('audio/ogg');
  });

  it('returns undefined when nothing is supported, so the browser default is used', () => {
    expect(pickRecordingMime(supporting())).toBeUndefined();
  });

  it('checks the real MediaRecorder when no checker is given, and copes with its absence', () => {
    expect(typeof MediaRecorder).toBe('undefined');
    expect(pickRecordingMime()).toBeUndefined();
  });
});

describe('baseMime and audioExtension', () => {
  it('drops codec parameters and case', () => {
    expect(baseMime('audio/webm;codecs=opus')).toBe('audio/webm');
    expect(baseMime(' Audio/MP4 ; codecs=mp4a.40.2')).toBe('audio/mp4');
  });

  it('names files for upload by what is inside', () => {
    expect(audioExtension('audio/webm;codecs=opus')).toBe('webm');
    expect(audioExtension('audio/mp4')).toBe('m4a');
    expect(audioExtension('audio/ogg;codecs=opus')).toBe('ogg');
    expect(audioExtension('audio/mpeg')).toBe('mp3');
    expect(audioExtension('application/octet-stream')).toBe('webm');
  });
});
