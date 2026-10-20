/**
 * Voice capture: recording with crash-safe chunks, microphone level, live dictation, recovery of
 * interrupted recordings, waveforms. Browser APIs sit behind small interfaces (see `RecorderDeps`),
 * so everything here is testable without a browser.
 *
 *   const recorder = new Recorder({ context: 'walk' });
 *   recorder.on('tick', ({ elapsedMs }) => …);
 *   recorder.level.subscribe((level) => …);      // 0..1, for the orb
 *   await recorder.start();                      // MicrophoneError (Russian message) if refused
 *   const result = await recorder.stop();        // audio saved, Capture.audioId set
 *
 *   const lost = await findUnfinishedRecordings(); // at app start
 */
export { Recorder, RecorderError, DEFAULT_TIMESLICE_MS, browserRecorderDeps } from './recorder';
export type {
  MediaRecorderLike,
  RecorderDeps,
  RecorderErrorCode,
  RecorderEvents,
  RecorderOptions,
  RecorderState,
  RecordingResult,
} from './recorder';

export { findUnfinishedRecordings, recoverRecording, recoverAllRecordings, discardRecording, RecordingInProgressError } from './recovery';
export type { RecoverableRecording, RecoveredRecording, RecoveryOptions, RecoveryReport } from './recovery';

export { LiveDictation, browserSpeechRecognition } from './live-dictation';
export type {
  DictationError,
  DictationErrorCode,
  DictationEvents,
  DictationState,
  DictationTranscript,
  LiveDictationOptions,
  SpeechRecognitionFactory,
  SpeechRecognitionLike,
} from './live-dictation';

export {
  ACCESS_MESSAGES,
  MICROPHONE_MESSAGES,
  MicrophoneError,
  getMicrophoneAccess,
  probeMicrophone,
  requestMicrophone,
  toMicrophoneError,
  watchMicrophoneAccess,
} from './permissions';
export type { MicrophoneAccess, MicrophoneEnvironment, MicrophoneErrorCode } from './permissions';

export { WaveformError, clearWaveformCache, computePeaks, computeWaveform, getWaveform } from './waveform';
export type { DecodeAudio, DecodedAudio, Waveform, WaveformOptions } from './waveform';

export { RECORDING_MIME_CANDIDATES, audioExtension, baseMime, pickRecordingMime } from './mime';
export type { LevelSource } from './level';
export { RecordingLocks, recordingLocks } from './locks';
export { ScreenWakeLock } from './wake-lock';
