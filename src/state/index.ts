/**
 * Application state that outlives screens: the recording machine, background processing of saved
 * captures, recovery of lost recordings, walk mode. Screens read it through hooks; nothing here renders.
 */
export {
  UNDO_THRESHOLD_MS,
  browserRecorderServiceDeps,
  createRecorderService,
  dictationLanguage,
  recorderService,
  selectIsRecording,
  useRecorder,
} from './recorder';
export type {
  CancelOutcome,
  DictationLike,
  DictationStatus,
  MediaSessionHandlers,
  MicProblem,
  RecorderLike,
  RecorderPhase,
  RecorderService,
  RecorderServiceDeps,
  RecorderStoreState,
  StartOptions,
} from './recorder';

export { browserProcessingDeps, createProcessing, processing, useJob } from './processing';
export type { Job, JobStage, ProcessingDeps, ProcessingService, SettledEvent, WaitingReason } from './processing';

export { browserRecoveryDeps, createRecoveryService, recoveryService, useRecovery } from './recovery';
export type { RecoveryDeps, RecoveryService, RecoveryState } from './recovery';

export { ACTIVITY_EVENTS, WALK_IDLE_MS, createIdleWatcher, useWalkMode } from './walkMode';
export type { IdleWatcher, IdleWatcherOptions } from './walkMode';
