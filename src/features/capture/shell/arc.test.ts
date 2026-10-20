import { describe, expect, it } from 'vitest';
import { ARC_ACTIONS, ARC_RADIUS, arcPositions, satelliteAt } from './arc';

const phone = { width: 390, height: 844 };
const origin = { x: 195, y: 790 };

describe('the arc over the sphere', () => {
  it('has the four actions of §3.2 in order, from the left', () => {
    expect(ARC_ACTIONS.map((a) => a.label)).toEqual(['Текст', 'Состояние', 'Импорт ИИ-диалога', 'Быстрая мысль']);
    expect(ARC_ACTIONS.map((a) => a.angle)).toEqual([-150, -110, -70, -30]);
  });

  it('puts every satellite on a circle of radius 96 over the finger', () => {
    for (const { x, y } of arcPositions(origin, phone)) {
      expect(Math.hypot(x - origin.x, y - origin.y)).toBeCloseTo(ARC_RADIUS, 5);
      expect(y).toBeLessThan(origin.y);
    }
  });

  it('is symmetric around the sphere', () => {
    const [text, , , quick] = arcPositions(origin, phone);
    expect(origin.x - text!.x).toBeCloseTo(quick!.x - origin.x, 5);
    expect(text!.y).toBeCloseTo(quick!.y, 5);
  });

  it('pushes satellites back inside a narrow screen when the sphere is off-centre', () => {
    const left = arcPositions({ x: 40, y: 790 }, phone);
    for (const { x } of left) expect(x).toBeGreaterThanOrEqual(8 + 28);
    const right = arcPositions({ x: 360, y: 790 }, phone);
    for (const { x } of right) expect(x).toBeLessThanOrEqual(390 - 8 - 28);
  });

  it('finds the satellite under the finger, and none in empty space', () => {
    const satellites = arcPositions(origin, phone);
    const import_ = satellites[2]!;
    expect(satelliteAt(satellites, { x: import_.x + 10, y: import_.y - 10 })).toBe('import');
    expect(satelliteAt(satellites, origin)).toBeNull();
    expect(satelliteAt(satellites, { x: 5, y: 5 })).toBeNull();
  });

  it('picks the nearest of two satellites in reach', () => {
    const satellites = arcPositions(origin, phone);
    const [, checkin, import_] = satellites;
    const between = { x: (checkin!.x + import_!.x) / 2 + 3, y: (checkin!.y + import_!.y) / 2 };
    // Closer to the right one by 3 px.
    expect(satelliteAt(satellites, between, 80)).toBe('import');
  });
});
