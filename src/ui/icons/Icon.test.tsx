import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ICON_NAMES, Icon } from '.';

const REQUIRED = [
  'today', 'stream', 'orbit', 'me', 'mic', 'text', 'pause', 'stop', 'check', 'close', 'plus', 'search', 'ask',
  'flame', 'alert', 'person', 'project', 'idea', 'decision', 'commitment', 'prediction', 'task', 'question',
  'lesson', 'fact', 'calendar', 'settings', 'lock', 'share', 'play', 'chevron-right', 'chevron-left', 'more',
  'trash', 'link',
];

describe('Icon', () => {
  it('ships every icon the interface needs', () => {
    for (const name of REQUIRED) expect(ICON_NAMES, name).toContain(name);
  });

  it.each(ICON_NAMES)('%s draws on the 24 grid with a 1.5 stroke in currentColor and has geometry', (name) => {
    const { container } = render(<Icon name={name} />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
    expect(svg).toHaveAttribute('stroke', 'currentColor');
    expect(svg).toHaveAttribute('stroke-width', '1.5');
    expect(svg).toHaveAttribute('fill', 'none');
    expect(svg.querySelectorAll('path, circle, ellipse, rect, line').length).toBeGreaterThan(0);
  });

  it('is decorative without a title and named with one', () => {
    const { container, rerender } = render(<Icon name="mic" />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('img')).toBeNull();
    rerender(<Icon name="mic" title="Микрофон" />);
    expect(screen.getByRole('img', { name: 'Микрофон' })).toBeInTheDocument();
  });

  it('honours size', () => {
    const { container } = render(<Icon name="plus" size={32} />);
    expect(container.querySelector('svg')).toHaveAttribute('width', '32');
  });
});
