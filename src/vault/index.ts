import { db } from '../db/schema';
import { createVaultRuntime } from './session';

/** Encryption at rest for the app's database (off until the person turns it on). */
export const vault = createVaultRuntime({ app: 'orbita', db, journalName: 'orbita-vault' });
export { useVaultState } from './state';
