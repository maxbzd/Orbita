import { vi } from 'vitest';
import { resetTileCache } from './backdrop/stars';

/** jsdom has no canvas: make `getContext` quietly return null (the sky and grain degrade to nothing). */
export function stubCanvas(): void {
  resetTileCache();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
}
