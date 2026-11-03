import { fromBase64, toBase64 } from '@/crypto/bytes';
import { finishJoin, readJoinRequest, startJoin } from '@/crypto/pairing';
import type { JoinRequest } from '@/crypto/pairing';
import { formatRecoveryKey } from '@/vault/keys';
import { db, getStoredSettings, updateSettings } from '../db';
import { markAllUnsent } from './engine';
import { CLOUD_KEY_PURPOSE, cloudKeyFromText, importCloudKey, makeCloudKey } from './e2eCrypto';
import { syncNow } from './service';

/** Turning cloud encryption on, and moving the key between devices. The key lives only in this device's settings. */

export async function storeCloudKey(raw: Uint8Array): Promise<void> {
  await updateSettings({ e2e: { key: toBase64(raw), id: (await importCloudKey(raw)).id } });
}

/**
 * Makes a key and seals the whole cloud copy with it. What was waiting to be sent goes first (in the clear, as before),
 * then every record and recording is sent again, sealed, over the plain copy. Returns the recovery key to write down.
 */
export async function enableCloudEncryption(): Promise<string> {
  await syncNow({ push: true });
  const made = await makeCloudKey();
  await storeCloudKey(made.raw);
  await markAllUnsent();
  await syncNow({ push: true });
  return made.text;
}

/** The recovery key again, for someone who wants to see it or write it down a second time. */
export async function cloudRecoveryText(): Promise<string | null> {
  const key = (await getStoredSettings()).e2e?.key;
  return key ? formatRecoveryKey(fromBase64(key)) : null;
}

/** This device is joining an encrypted account with the key in hand: from the recovery key, or from another device. */
export async function joinWithKey(raw: Uint8Array): Promise<void> {
  await storeCloudKey(raw);
  // the records were skipped while there was no key: read the cloud again from the start
  await db.syncmeta.delete('@cursor');
  await syncNow();
}

export async function joinWithRecoveryText(text: string): Promise<boolean> {
  const raw = await cloudKeyFromText(text);
  if (!raw) return false;
  await joinWithKey(raw);
  return true;
}

// ---- the two sides of "add a device" ----

/** The new device: makes the request to show, then waits for the answer. */
export const beginJoin = (): Promise<JoinRequest> => startJoin();

export async function completeJoin(request: JoinRequest, answerCode: string): Promise<void> {
  await joinWithKey(await finishJoin(request, answerCode, CLOUD_KEY_PURPOSE));
}

/** The old device: reads the new device's code (and shows the check digits), then makes the answer to give back. */
export async function answerJoin(requestCode: string): Promise<{ checkDigits: string; answer(): Promise<string> }> {
  const key = (await getStoredSettings()).e2e?.key;
  if (!key) throw new Error('This device has no cloud key.');
  const read = await readJoinRequest(requestCode);
  return { checkDigits: read.checkDigits, answer: () => read.seal(fromBase64(key), CLOUD_KEY_PURPOSE) };
}
