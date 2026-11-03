import { concat, fromBase64, toBase64, utf8 } from '@/crypto/bytes';
import { aesKeyFrom, hkdfBits } from '@/crypto/password';
import { newRecoveryKey, parseRecoveryKey } from '@/vault/keys';

/**
 * End-to-end encryption of the cloud copy. One random 256-bit key (the "cloud key") lives on your devices; every record
 * and every recording is sealed with it before it leaves, so the server stores only data it cannot read, and neither
 * can anyone who gets into the server. Merging happens on the devices, after opening, so nothing about syncing changes.
 *
 * What the server still sees: which table and id a record belongs to, when it changed (its version stamp), how big it
 * is, and that a deletion happened. What stops working: anything that reads records on the server.
 *
 * A new device gets the key from an old one (`crypto/pairing.ts`: hybrid, quantum-safe) or from the recovery key written
 * down when this was turned on. Lose every device and the recovery key, and the cloud copy is unreadable by design.
 */

export const CLOUD_KEY_PURPOSE = 'orbita/cloud-key';

export interface CloudKey {
  /** short, public: tells which key sealed a record */
  id: string;
  key: CryptoKey;
}

export interface Envelope {
  _e2e: 1;
  k: string;
  iv: string;
  c: string;
}

export const isEnvelope = (value: unknown): value is Envelope =>
  !!value && typeof value === 'object' && (value as Envelope)._e2e === 1 && typeof (value as Envelope).c === 'string';

/** The AES key for records comes from the cloud key through HKDF, so the raw key is never used directly. */
export async function importCloudKey(raw: Uint8Array): Promise<CloudKey> {
  const id = toBase64(new Uint8Array(await crypto.subtle.digest('SHA-256', raw as Uint8Array<ArrayBuffer>)).slice(0, 6));
  return { id, key: await aesKeyFrom(await hkdfBits(raw, 'orbita/cloud/record-key')) };
}

const aadOf = (tbl: string, id: string): Uint8Array<ArrayBuffer> => utf8(`orbita/cloud/${tbl}/${id}`);

export async function sealRecord(k: CloudKey, tbl: string, id: string, data: unknown): Promise<Envelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aadOf(tbl, id) }, k.key, utf8(JSON.stringify(data)));
  return { _e2e: 1, k: k.id, iv: toBase64(iv), c: toBase64(new Uint8Array(sealed)) };
}

/** `undefined` when it does not open with this key (another key, a changed record, or a record moved to another place). */
export async function openRecord(k: CloudKey, tbl: string, id: string, env: Envelope): Promise<unknown> {
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(env.iv), additionalData: aadOf(tbl, id) }, k.key, fromBase64(env.c));
    return JSON.parse(new TextDecoder().decode(plain)) as unknown;
  } catch {
    return undefined;
  }
}

// ───────── Recordings ─────────

/** `OE2E1`, the type's length, the type, the IV, then the sealed bytes. */
const AUDIO_MAGIC = utf8('OE2E1');
const audioAad = (captureId: string): Uint8Array<ArrayBuffer> => utf8(`orbita/cloud/audio/${captureId}`);

export async function sealAudio(k: CloudKey, captureId: string, blob: Blob): Promise<Blob> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const mime = utf8((blob.type || 'audio/webm').slice(0, 100));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: audioAad(captureId) }, k.key, await blob.arrayBuffer()));
  return new Blob([concat(AUDIO_MAGIC, new Uint8Array([mime.length]), mime, iv, sealed)], { type: 'application/octet-stream' });
}

export async function isSealedAudio(blob: Blob): Promise<boolean> {
  const head = new Uint8Array(await blob.slice(0, AUDIO_MAGIC.length).arrayBuffer());
  return head.length === AUDIO_MAGIC.length && AUDIO_MAGIC.every((byte, index) => head[index] === byte);
}

/** `null` when it does not open with this key. */
export async function openAudio(k: CloudKey, captureId: string, blob: Blob): Promise<Blob | null> {
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let at = AUDIO_MAGIC.length;
    const mimeLength = bytes[at++] ?? 0;
    const mime = new TextDecoder().decode(bytes.subarray(at, at + mimeLength));
    at += mimeLength;
    const iv = bytes.slice(at, at + 12);
    at += 12;
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: audioAad(captureId) }, k.key, bytes.subarray(at));
    return new Blob([plain], { type: mime });
  } catch {
    return null;
  }
}

// ───────── The key people write down ─────────

/** A new cloud key, and the text to write down for it (the same format as the vault's recovery key, with a check). */
export async function makeCloudKey(): Promise<{ raw: Uint8Array<ArrayBuffer>; text: string }> {
  const { bytes, text } = await newRecoveryKey();
  return { raw: bytes, text };
}

export const cloudKeyFromText = (text: string): Promise<Uint8Array<ArrayBuffer> | null> => parseRecoveryKey(text);
