import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from 'react';
import type { NavLinkItem } from './destinations';

export interface NavLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'onClick' | 'children'> {
  item: Pick<NavLinkItem, 'id' | 'href'>;
  active?: boolean;
  /** Called on a plain left click; the browser navigation is cancelled so the router can take over. */
  onNavigate?(item: Pick<NavLinkItem, 'id' | 'href'>): void;
  children: ReactNode;
}

/** A real link (middle click and "open in new tab" keep working) that hands plain clicks to the router. */
export function NavLink({ item, active, onNavigate, children, ...rest }: NavLinkProps) {
  const onClick = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (!onNavigate || event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onNavigate(item);
  };
  return (
    <a href={item.href} aria-current={active ? 'page' : undefined} onClick={onClick} {...rest}>
      {children}
    </a>
  );
}
