/**
 * Container/codec choice for MediaRecorder, best first: WebM/Opus (Chrome, Edge, Firefox, Android),
 * MP4/AAC (Safari and iOS before 18.4), Ogg/Opus. Opus is the smallest at speech quality.
 */
export const RECORDING_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/ogg;codecs=opus',
  'audio/ogg',
] as const;

export type MimeSupportCheck = (mime: string) => boolean;

const browserSupports: MimeSupportCheck = (mime) =>
  typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(mime);

/** The first supported mime type; undefined when none is, so the browser should pick its own default. */
export function pickRecordingMime(isSupported: MimeSupportCheck = browserSupports): string | undefined {
  return RECORDING_MIME_CANDIDATES.find((mime) => isSupported(mime));
}

/** `audio/webm;codecs=opus` → `audio/webm` */
export function baseMime(mime: string): string {
  return (mime.split(';')[0] ?? '').trim().toLowerCase();
}

const EXTENSIONS: Readonly<Record<string, string>> = {
  'audio/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/flac': 'flac',
};

/** File extension for a recording, e.g. for the file name of a transcription upload (servers sniff by it). */
export function audioExtension(mime: string): string {
  return EXTENSIONS[baseMime(mime)] ?? 'webm';
}
