import { folderAccess, writeToFolder } from '../lib/folder';
import { exportBackup } from './backup';
import { sealBackupToKey } from './backupKey';
import { getStoredSettings, updateSettings } from './settings';

export const AUTO_BACKUP_PREFIX = 'orbita-auto-';
const KEEP = 14;
const DAY = 86_400_000;

export type AutoBackupResult = 'off' | 'not-due' | 'needs-permission' | 'written' | 'failed';

let running = false;

/**
 * Writes an encrypted copy into the chosen folder if one is due. It needs no secret: the copy is sealed to the public
 * key set up with the passphrase. Recordings and API keys are not in it (a copy a day would fill the folder with sound,
 * and keys have no business in a file left on disk). If the browser has not kept the folder permission (it asks again after
 * a restart on some systems), nothing is written and Settings offers one tap to allow it.
 */
export async function runAutoBackup({ force = false, now = Date.now() }: { force?: boolean; now?: number } = {}): Promise<AutoBackupResult> {
  if (running) return 'not-due';
  const config = (await getStoredSettings()).autoBackup;
  if (!config) return 'off';
  if (!force && config.lastAt && now - config.lastAt < config.everyDays * DAY) return 'not-due';
  running = true;
  try {
    if ((await folderAccess()) !== 'granted') return 'needs-permission';
    const file = await sealBackupToKey(await exportBackup({ includeAudio: false, includeSecrets: false }), config);
    const day = new Date(now).toISOString().slice(0, 10);
    await writeToFolder(`${AUTO_BACKUP_PREFIX}${day}.enc.json`, JSON.stringify(file), AUTO_BACKUP_PREFIX, KEEP);
    const current = (await getStoredSettings()).autoBackup;
    if (current) await updateSettings({ autoBackup: { ...current, lastAt: now } });
    return 'written';
  } catch {
    return 'failed';
  } finally {
    running = false;
  }
}
