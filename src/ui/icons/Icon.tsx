import type { SVGProps } from 'react';
import { ICONS } from './paths';
import type { IconName } from './paths';

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name' | 'children' | 'title'> {
  name: IconName;
  /** CSS px (or any CSS length). Default 24. */
  size?: number | string;
  strokeWidth?: number;
  /** Accessible name. Without it the icon is decorative (aria-hidden). */
  title?: string;
}

/** One outline icon set: 24x24 grid, 1.5 px stroke, round caps and joins, `currentColor`. */
export function Icon({ name, size = 24, strokeWidth = 1.5, title, ...rest }: IconProps) {
  const label = title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true, focusable: false };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...label}
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {ICONS[name]}
    </svg>
  );
}
