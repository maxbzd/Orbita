import { describe, expect, it, vi } from 'vitest';
import { LevelMeter, levelOfSamples } from './level';
import { FakeAnalyser, ManualScheduler } from './test-fakes';

describe('levelOfSamples', () => {
  const constant = (value: number) => new Float32Array(64).fill(value);

  it('maps silence to 0 and a loud signal to 1', () => {
    expect(levelOfSamples(new Float32Array(0))).toBe(0);
    expect(levelOfSamples(constant(0))).toBe(0);
    expect(levelOfSamples(constant(0.0005))).toBe(0);
    expect(levelOfSamples(constant(0.9))).toBe(1);
  });

  it('grows with loudness, in decibels', () => {
    const quiet = levelOfSamples(constant(0.005));
    const speech = levelOfSamples(constant(0.05));
    const loud = levelOfSamples(constant(0.2));
    expect(quiet).toBeGreaterThan(0);
    expect(speech).toBeGreaterThan(quiet);
    expect(loud).toBeGreaterThan(speech);
    expect(loud).toBeLessThan(1);
  });

  it('measures energy, not the sign of the samples', () => {
    expect(levelOfSamples(constant(-0.05))).toBeCloseTo(levelOfSamples(constant(0.05)), 10);
  });
});

describe('LevelMeter', () => {
  function setup() {
    const scheduler = new ManualScheduler();
    const analyser = new FakeAnalyser();
    const meter = new LevelMeter(scheduler);
    return { scheduler, analyser, meter };
  }

  it('stays at 0 and silent until attached', () => {
    const { meter, scheduler } = setup();
    expect(meter.value).toBe(0);
    expect(scheduler.pending).toBe(0);
  });

  it('rises quickly on a sound and falls slowly after it, reporting every change', () => {
    const { meter, scheduler, analyser } = setup();
    const seen: number[] = [];
    meter.subscribe((level) => seen.push(level));
    meter.attach(analyser);

    analyser.setAmplitude(0.1);
    scheduler.step(16);
    const risen = meter.value;
    expect(risen).toBeGreaterThan(0);
    for (let time = 32; time <= 160; time += 16) scheduler.step(time);
    const loud = meter.value;
    expect(loud).toBeGreaterThan(risen);
    expect(loud).toBeLessThanOrEqual(1);

    analyser.setAmplitude(0);
    scheduler.step(176);
    const dropped = loud - meter.value;
    expect(meter.value).toBeGreaterThan(loud / 2);
    expect(dropped).toBeGreaterThan(0);

    expect(seen.length).toBeGreaterThan(5);
    expect(seen.every((level) => level >= 0 && level <= 1)).toBe(true);
    expect(seen.at(-1)).toBe(meter.value);
  });

  it('settles back to exactly 0 in a quiet room and then stops reporting', () => {
    const { meter, scheduler, analyser } = setup();
    meter.attach(analyser);
    analyser.setAmplitude(0.1);
    scheduler.step(16);
    analyser.setAmplitude(0);
    let time = 16;
    for (let frame = 0; frame < 200 && meter.value > 0; frame++) scheduler.step((time += 16));
    expect(meter.value).toBe(0);

    const listener = vi.fn();
    meter.subscribe(listener);
    for (let frame = 0; frame < 10; frame++) scheduler.step((time += 16));
    expect(listener).not.toHaveBeenCalled();
  });

  it('drops to 0 and stops asking for frames on pause, and carries on after resume', () => {
    const { meter, scheduler, analyser } = setup();
    meter.attach(analyser);
    analyser.setAmplitude(0.1);
    scheduler.step(16);
    expect(meter.value).toBeGreaterThan(0);

    meter.pause();
    expect(meter.value).toBe(0);
    expect(scheduler.pending).toBe(0);

    meter.resume();
    expect(scheduler.pending).toBe(1);
    scheduler.step(1000);
    expect(meter.value).toBeGreaterThan(0);
  });

  it('forgets the analyser on detach, and resume is then a no-op', () => {
    const { meter, scheduler, analyser } = setup();
    meter.attach(analyser);
    meter.detach();
    meter.resume();
    expect(scheduler.pending).toBe(0);
    expect(meter.value).toBe(0);
  });

  it('stops notifying an unsubscribed listener', () => {
    const { meter, scheduler, analyser } = setup();
    const listener = vi.fn();
    const unsubscribe = meter.subscribe(listener);
    meter.attach(analyser);
    analyser.setAmplitude(0.1);
    scheduler.step(16);
    expect(listener).toHaveBeenCalled();
    unsubscribe();
    listener.mockClear();
    scheduler.step(32);
    expect(listener).not.toHaveBeenCalled();
  });
});
