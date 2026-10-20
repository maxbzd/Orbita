import { createElement, forwardRef } from 'react';
import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';
import styles from './Glass.module.css';

/**
 * Glass budget (docs/DESIGN.md, decision 4):
 *   'real'  true backdrop blur. Only the nav pill, sheets, the composer and the mini recorder; at
 *           most 2-3 per screen and never over an animated layer. Falls back to a solid fill on
 *           low tiers, with prefers-reduced-transparency, or when the browser cannot blur.
 *   'light' "light glass": translucent fill + hairline border + highlight, no blur. Cards.
 *   'flat'  plain surface for lists and forms.
 */
export type GlassVariant = 'real' | 'light' | 'flat';
export type GlassRadius = 'sm' | 'md' | 'card' | 'sheet' | 'bar' | 'pill' | 'none';

export interface GlassProps extends HTMLAttributes<HTMLElement> {
  variant?: GlassVariant;
  /** `real` only: `bar` = small surface (nav pill, recorder); `panel` = large (sheet, composer). */
  size?: 'bar' | 'panel';
  radius?: GlassRadius;
  as?: 'div' | 'section' | 'article' | 'nav' | 'header' | 'footer' | 'aside' | 'ul' | 'li' | 'form';
  children?: ReactNode;
}

const RADIUS: Record<GlassRadius, string> = {
  sm: 'var(--r-sm)',
  md: 'var(--r-md)',
  card: 'var(--r-card)',
  sheet: 'var(--r-sheet)',
  bar: 'var(--r-bar)',
  pill: 'var(--r-pill)',
  none: '0',
};

export const Glass = forwardRef<HTMLElement, GlassProps>(function Glass(
  { variant = 'light', size = 'bar', radius = 'card', as = 'div', className, style, children, ...rest },
  ref,
) {
  return createElement(
    as,
    {
      ref,
      className: cx(styles.glass, styles[variant], variant === 'real' && size === 'panel' && styles.panel, className),
      style: { '--glass-radius': RADIUS[radius], ...style } as CSSProperties,
      'data-glass': variant,
      ...rest,
    },
    children,
  );
});
