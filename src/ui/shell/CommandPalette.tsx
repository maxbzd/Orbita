import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Icon } from '../icons';
import { Dialog } from '../primitives/Dialog';
import { Kbd, KbdCombo } from '../primitives/Kbd';
import { cx } from '../primitives/cx';
import { filterCommands } from './commandFilter';
import type { CommandItem, CommandProvider } from './commandFilter';
import styles from './CommandPalette.module.css';
import { t } from '../../i18n';

export interface CommandPaletteProps {
  open: boolean;
  onClose(): void;
  /** Static actions, filtered locally by the query. */
  actions?: readonly CommandItem[];
  /** Query-dependent sources (search, people). They run after a short pause. */
  providers?: readonly CommandProvider[];
  placeholder?: string;
  /** Pause in ms before the providers run while typing. Default 120. */
  debounceMs?: number;
}

interface Row {
  item: CommandItem;
  /** Group heading to draw before this row, if it starts a group. */
  heading?: string;
}

function withHeadings(items: readonly CommandItem[]): Row[] {
  let previous: string | undefined;
  return items.map((item, i) => {
    const row: Row = { item };
    if (item.group && (i === 0 || item.group !== previous)) row.heading = item.group;
    previous = item.group;
    return row;
  });
}

/**
 * Ctrl/⌘+K: a dialog with a search field and a list of actions and results. A combobox in the ARIA
 * sense: focus stays in the field, the highlighted option is `aria-activedescendant`, arrows move it,
 * Enter runs it, Esc closes. Actions and providers come in as props; the shell wires the real ones later.
 */
export function CommandPalette({ open, onClose, actions = [], providers = [], placeholder = t('What to do or find?'), debounceMs = 120 }: CommandPaletteProps) {
  const listId = useId();
  const [query, setQuery] = useState('');
  const [remote, setRemote] = useState<CommandItem[]>([]);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  // A fresh start every time the palette opens.
  useEffect(() => {
    if (open) {
      setQuery('');
      setRemote([]);
      setActive(0);
    }
  }, [open]);

  // Providers: debounced, and a stale answer never overwrites a newer one.
  useEffect(() => {
    if (!open || providers.length === 0) return;
    const controller = new AbortController();
    const timer = window.setTimeout(
      () => {
        void Promise.all(
          providers.map(async (provider) => {
            try {
              const found = await provider.search(query, controller.signal);
              return provider.group ? found.map((item) => ({ ...item, group: item.group ?? provider.group })) : found;
            } catch {
              return []; // one failing source must not blank the palette
            }
          }),
        ).then((groups) => {
          if (!controller.signal.aborted) setRemote(groups.flat());
        });
      },
      query ? debounceMs : 0,
    );
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, query, providers, debounceMs]);

  const rows = useMemo(() => withHeadings([...filterCommands(actions, query), ...remote]), [actions, query, remote]);
  const activeIndex = Math.min(active, Math.max(0, rows.length - 1));
  const optionId = (index: number): string => `${listId}-option-${index}`;

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex, rows]);

  const run = (item: CommandItem): void => {
    onClose();
    item.run();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    const count = rows.length;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (count) setActive((activeIndex + 1) % count);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (count) setActive((activeIndex - 1 + count) % count);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActive(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActive(Math.max(0, count - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const row = rows[activeIndex];
      if (row) run(row.item);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title={t('Command palette')} bare placement="top" size="lg">
      <div className={styles.palette}>
        <div className={styles.search}>
          <Icon name="search" size={20} />
          <input
            className={styles.input}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={rows.length ? optionId(activeIndex) : undefined}
            aria-label={t('Search commands and records')}
            placeholder={placeholder}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
          />
          <Kbd>Esc</Kbd>
        </div>

        <ul ref={listRef} id={listId} role="listbox" aria-label={t('Results')} className={styles.list}>
          {rows.map((row, index) => {
            const { item } = row;
            const selected = index === activeIndex;
            return (
              <li key={`${item.id}-${index}`} role="presentation">
                {row.heading ? <p className={styles.heading}>{row.heading}</p> : null}
                <div
                  id={optionId(index)}
                  role="option"
                  aria-selected={selected}
                  className={cx(styles.option, selected && styles.selected)}
                  onMouseMove={() => selected || setActive(index)}
                  onClick={() => run(item)}
                >
                  {item.icon ? <Icon name={item.icon} size={20} /> : <span className={styles.noIcon} />}
                  <span className={styles.text}>
                    <span className={styles.title}>{item.title}</span>
                    {item.subtitle ? <span className={styles.subtitle}>{item.subtitle}</span> : null}
                  </span>
                  {item.shortcut ? <KbdCombo keys={item.shortcut} /> : null}
                </div>
              </li>
            );
          })}
        </ul>

        {rows.length === 0 ? <p className={styles.empty}>{t('Nothing found. Try another word.')}</p> : null}
        <p className="sr-only" role="status" aria-live="polite">
          {rows.length === 0 ? t('Nothing found') : t('Found: {count}', { count: rows.length })}
        </p>

        <footer className={styles.footer} aria-hidden="true">
          <span>
            <Kbd>↑</Kbd> <Kbd>↓</Kbd>{' '}{t('select')}
          </span>
          <span>
            <Kbd>Enter</Kbd>{' '}{t('run')}
          </span>
        </footer>
      </div>
    </Dialog>
  );
}
