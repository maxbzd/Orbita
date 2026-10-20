/**
 * Name labels next to the stars of a constellation. Every star tries four spots (under, above, to the right, to
 * the left) and takes the first one that touches no other label, no star and not the edge of the picture; when
 * every spot collides, the one with the fewest collisions wins. Pure and deterministic: bigger stars choose first.
 */
export interface LabelStar {
  id: string;
  x: number;
  y: number;
  r: number;
  text: string;
}

export interface PlacedLabel {
  x: number;
  y: number;
  anchor: 'start' | 'middle' | 'end';
}

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface LabelOptions {
  /** Width of one character in viewBox units (the label font is mono 11: about 6.6). */
  charWidth?: number;
  fontSize?: number;
  /** Space between a star and its label. */
  gap?: number;
}

const overlaps = (a: Rect, b: Rect): boolean => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

export function placeLabels(stars: readonly LabelStar[], width: number, height: number, { charWidth = 6.6, fontSize = 11, gap = 5 }: LabelOptions = {}): Map<string, PlacedLabel> {
  const discs: Rect[] = stars.map((s) => ({ left: s.x - s.r - 2, right: s.x + s.r + 2, top: s.y - s.r - 2, bottom: s.y + s.r + 2 }));
  const taken: Rect[] = [];
  const result = new Map<string, PlacedLabel>();
  const order = [...stars].sort((a, b) => b.r - a.r || a.id.localeCompare(b.id));

  for (const star of order) {
    const w = star.text.length * charWidth;
    const h = fontSize;
    const candidates: Array<{ place: PlacedLabel; rect: Rect }> = [
      { place: { x: star.x, y: star.y + star.r + gap + h * 0.8, anchor: 'middle' }, rect: { left: star.x - w / 2, right: star.x + w / 2, top: star.y + star.r + gap, bottom: star.y + star.r + gap + h } },
      { place: { x: star.x, y: star.y - star.r - gap, anchor: 'middle' }, rect: { left: star.x - w / 2, right: star.x + w / 2, top: star.y - star.r - gap - h, bottom: star.y - star.r - gap } },
      { place: { x: star.x + star.r + gap, y: star.y + h * 0.35, anchor: 'start' }, rect: { left: star.x + star.r + gap, right: star.x + star.r + gap + w, top: star.y - h / 2, bottom: star.y + h / 2 } },
      { place: { x: star.x - star.r - gap, y: star.y + h * 0.35, anchor: 'end' }, rect: { left: star.x - star.r - gap - w, right: star.x - star.r - gap, top: star.y - h / 2, bottom: star.y + h / 2 } },
    ];
    let best = candidates[0]!;
    let bestScore = Infinity;
    for (const candidate of candidates) {
      const { rect } = candidate;
      let score = 0;
      if (rect.left < 0 || rect.right > width || rect.top < 0 || rect.bottom > height) score += 4;
      score += taken.filter((t) => overlaps(rect, t)).length * 3;
      score += discs.filter((d, i) => stars[i] !== star && overlaps(rect, d)).length * 2;
      if (score < bestScore) {
        best = candidate;
        bestScore = score;
        if (score === 0) break;
      }
    }
    taken.push(best.rect);
    result.set(star.id, best.place);
  }
  return result;
}
