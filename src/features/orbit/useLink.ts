import type { MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';

export interface LinkProps {
  href: string;
  onClick(event: MouseEvent<HTMLElement>): void;
}

/** Props that make a row a real link (`#/…`, openable in a new tab) that still navigates inside the app. */
export function useLinkProps(): (to: string) => LinkProps {
  const navigate = useNavigate();
  return (to) => ({
    href: `#${to}`,
    onClick: (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1) return;
      event.preventDefault();
      navigate(to);
    },
  });
}
