import type { ID } from './types';

/**
 * Random UUID v4. Built on `getRandomValues` rather than `crypto.randomUUID`, because the latter
 * is missing in insecure contexts (e.g. the preview server opened over plain http on a LAN).
 */
export function newId(): ID {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  // RFC 4122 §4.4: version 4, variant 10xx.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
