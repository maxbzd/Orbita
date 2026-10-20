export { LockGate } from './LockGate';
export { LockScreen } from './LockScreen';
export {
  AUTO_LOCK_CHOICES,
  LockError,
  changePassword,
  disableLock,
  enableLock,
  initLock,
  lockNow,
  saveApiKeys,
  setAutoLockMinutes,
  setLockIterations,
  throttleSeconds,
  unlock,
  useLockStore,
  validateNewPassword,
} from './lockService';
export type { LockStatus, UnlockResult } from './lockService';
export { collectSecrets, openSecrets, sealSecrets, SEALED_SECRETS_VERSION } from './secrets';
