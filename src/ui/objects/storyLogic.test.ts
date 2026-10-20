import { describe, expect, it } from 'vitest';
import { classifyGesture } from './storyLogic';

describe('classifyGesture', () => {
  it('turns a short still press into a tap by zone', () => {
    expect(classifyGesture({ dx: 0, dy: 0, duration: 120, x: 0.1 })).toBe('prev');
    expect(classifyGesture({ dx: 2, dy: -3, duration: 120, x: 0.29 })).toBe('prev');
    expect(classifyGesture({ dx: 0, dy: 0, duration: 120, x: 0.31 })).toBe('next');
    expect(classifyGesture({ dx: 0, dy: 0, duration: 120, x: 0.9 })).toBe('next');
  });

  it('treats a long still press as a hold', () => {
    expect(classifyGesture({ dx: 0, dy: 0, duration: 800, x: 0.9 })).toBe('hold');
  });

  it('pages on horizontal swipes: left goes forward, right goes back', () => {
    expect(classifyGesture({ dx: -80, dy: 10, duration: 200, x: 0.5 })).toBe('next');
    expect(classifyGesture({ dx: 80, dy: -10, duration: 200, x: 0.5 })).toBe('prev');
    expect(classifyGesture({ dx: -47, dy: 0, duration: 200, x: 0.5 })).toBe('none');
  });

  it('closes on a long swipe down only', () => {
    expect(classifyGesture({ dx: 5, dy: 120, duration: 200, x: 0.5 })).toBe('close');
    expect(classifyGesture({ dx: 5, dy: 90, duration: 200, x: 0.5 })).toBe('none');
    expect(classifyGesture({ dx: 0, dy: -150, duration: 200, x: 0.5 })).toBe('none');
  });
});
