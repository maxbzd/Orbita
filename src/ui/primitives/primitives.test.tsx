import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Badge } from './Badge';
import { Button } from './Button';
import { Chip } from './Chip';
import { EmptyState, ringDots } from './EmptyState';
import { Field, Search, TextArea } from './Field';
import { Glass } from './Glass';
import { IconButton } from './IconButton';
import { Kbd, KbdCombo } from './Kbd';
import { ListRow } from './ListRow';
import { Pill } from './Pill';
import { ProgressRing, ringGeometry } from './ProgressRing';
import { SegmentedControl } from './SegmentedControl';
import { Skeleton } from './Skeleton';
import { Body, Caption, Display, Heading, Label, Mono, Thought } from './Text';
import { Toggle } from './Toggle';
import { TypeMedallion } from './TypeMark';

describe('Button', () => {
  it('is a real button, type=button by default, and fires onClick', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Сохранить</Button>);
    const button = screen.getByRole('button', { name: 'Сохранить' });
    expect(button).toHaveAttribute('type', 'button');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('loading disables the button and marks it busy; disabled does not fire', () => {
    const onClick = vi.fn();
    const { rerender } = render(<Button loading onClick={onClick}>Разбираю</Button>);
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    rerender(<Button disabled onClick={onClick}>Нельзя</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it.each(['primary', 'secondary', 'ghost', 'ai', 'danger'] as const)('renders the %s variant', (variant) => {
    render(<Button variant={variant}>Кнопка</Button>);
    expect(screen.getByRole('button', { name: 'Кнопка' })).toBeInTheDocument();
  });
});

describe('IconButton', () => {
  it('has the required accessible name and exposes its pressed state', () => {
    render(<IconButton icon="pause" label="Пауза" pressed />);
    expect(screen.getByRole('button', { name: 'Пауза' })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('Toggle', () => {
  it('is a switch with its description, and toggles on click', () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} label="Режим прогулки" description="Через 20 секунд экран гаснет." />);
    const toggle = screen.getByRole('switch', { name: 'Режим прогулки' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(toggle).toHaveAccessibleDescription('Через 20 секунд экран гаснет.');
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

type Section = 'time' | 'people' | 'patterns';

describe('SegmentedControl', () => {
  function Demo() {
    const [value, setValue] = useState<Section>('time');
    return (
      <SegmentedControl<Section>
        aria-label="Раздел"
        value={value}
        onChange={setValue}
        options={[
          { value: 'time', label: 'Время' },
          { value: 'people', label: 'Люди' },
          { value: 'patterns', label: 'Паттерны' },
        ]}
      />
    );
  }

  it('is a radio group with a roving tabindex; arrows move and select, and wrap', () => {
    render(<Demo />);
    const [time, people, patterns] = screen.getAllByRole('radio');
    expect(screen.getByRole('radiogroup', { name: 'Раздел' })).toBeInTheDocument();
    expect(time).toHaveAttribute('aria-checked', 'true');
    expect(time).toHaveAttribute('tabindex', '0');
    expect(people).toHaveAttribute('tabindex', '-1');

    fireEvent.keyDown(time!, { key: 'ArrowRight' });
    expect(people).toHaveAttribute('aria-checked', 'true');
    expect(people).toHaveFocus();
    fireEvent.keyDown(people!, { key: 'End' });
    expect(patterns).toHaveAttribute('aria-checked', 'true');
    fireEvent.keyDown(patterns!, { key: 'ArrowRight' });
    expect(time).toHaveAttribute('aria-checked', 'true');
  });
});

describe('Field, TextArea, Search', () => {
  it('ties the label, hint and error to the input', () => {
    const { rerender } = render(<Field label="Имя" hint="Как к тебе обращаться" />);
    const input = screen.getByLabelText('Имя');
    expect(input).toHaveAccessibleDescription('Как к тебе обращаться');
    rerender(<Field label="Имя" hint="Как к тебе обращаться" error="Нужно имя" />);
    expect(screen.getByLabelText('Имя')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Имя')).toHaveAccessibleDescription('Нужно имя');
    expect(screen.getByRole('alert')).toHaveTextContent('Нужно имя');
  });

  it('TextArea carries its label too', () => {
    render(<TextArea label="Заметка" defaultValue="текст" />);
    expect(screen.getByLabelText('Заметка')).toHaveValue('текст');
  });

  it('Search clears with the button and with Escape', () => {
    function Demo() {
      const [value, setValue] = useState('ясно');
      return <Search value={value} onChange={setValue} aria-label="Поиск по записям" />;
    }
    render(<Demo />);
    const box = screen.getByRole('searchbox', { name: 'Поиск по записям' });
    expect(box).toHaveValue('ясно');
    fireEvent.click(screen.getByRole('button', { name: 'Очистить' }));
    expect(box).toHaveValue('');
    fireEvent.change(box, { target: { value: 'снова' } });
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(box).toHaveValue('');
  });
});

describe('ListRow, Chip, Badge, Pill', () => {
  it('a clickable row is one button with a chevron; the trailing action is separate', () => {
    const onClick = vi.fn();
    const onDone = vi.fn();
    render(<ListRow title="Отправить отчёт" subtitle="Фёдору" meta="через 4 дня" onClick={onClick} trailing={<button onClick={onDone}>Готово</button>} />);
    fireEvent.click(screen.getByRole('button', { name: /Отправить отчёт/ }));
    expect(onClick).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('a filter chip reports its pressed state; a plain chip is not a button', () => {
    const onClick = vi.fn();
    const { rerender } = render(<Chip type="decision" selected onClick={onClick} count={3} />);
    const chip = screen.getByRole('button', { name: /Решение/ });
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(chip);
    expect(onClick).toHaveBeenCalled();
    rerender(<Chip type="idea" />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Идея')).toBeInTheDocument();
  });

  it('Badge shows 99+ and hides at zero', () => {
    const { rerender, container } = render(<Badge count={120} />);
    expect(container).toHaveTextContent('99+');
    rerender(<Badge count={0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('a live Pill is a status region', () => {
    render(<Pill live dot tone="rec">Записываю</Pill>);
    expect(screen.getByRole('status')).toHaveTextContent('Записываю');
  });
});

describe('Text voices', () => {
  it('render the semantic tag each voice defaults to', () => {
    render(
      <>
        <Display>Записано</Display>
        <Heading>Раздел</Heading>
        <Body>Текст</Body>
        <Caption>мелко</Caption>
        <Thought>Мысль</Thought>
        <Label>Решение</Label>
        <Mono>02:14</Mono>
      </>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Записано' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Раздел' })).toBeInTheDocument();
    expect(screen.getByText('Мысль').tagName).toBe('P');
  });
});

describe('Glass, Kbd, TypeMedallion', () => {
  it('Glass tags its variant (the glass budget is checkable in the DOM)', () => {
    const { container } = render(<Glass variant="real">x</Glass>);
    expect(container.firstElementChild).toHaveAttribute('data-glass', 'real');
  });

  it('key caps render', () => {
    render(<KbdCombo keys={['Ctrl', 'K']} />);
    expect(screen.getAllByText(/Ctrl|K/)).toHaveLength(2);
    render(<Kbd>Esc</Kbd>);
    expect(screen.getByText('Esc').tagName).toBe('KBD');
  });

  it('a labelled medallion names the type, an unlabelled one is decorative', () => {
    const { container, rerender } = render(<TypeMedallion kind="commitment" labelled />);
    expect(container.firstElementChild).toHaveAccessibleName('Обязательство');
    rerender(<TypeMedallion kind="commitment" />);
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('ProgressRing', () => {
  it('geometry: the arc is value x circumference, and the value is clamped', () => {
    const g = ringGeometry(0.25, 56, 4);
    expect(g.radius).toBe(26);
    expect(g.dash).toBeCloseTo(g.circumference / 4);
    expect(ringGeometry(7, 56, 4).value).toBe(1);
    expect(ringGeometry(-1, 56, 4).value).toBe(0);
    expect(ringGeometry(Number.NaN, 56, 4).value).toBe(0);
    expect(ringGeometry(0.5, 4, 8).radius).toBe(0); // never negative
  });

  it('is a progressbar with a spoken value; indeterminate has no value', () => {
    const { rerender } = render(<ProgressRing value={6 / 14} label="Паттерны" valueText="6 из 14" />);
    const bar = screen.getByRole('progressbar', { name: 'Паттерны' });
    expect(bar).toHaveAttribute('aria-valuenow', '43');
    expect(bar).toHaveAttribute('aria-valuetext', '6 из 14');
    rerender(<ProgressRing label="Загрузка" />);
    expect(screen.getByRole('progressbar', { name: 'Загрузка' })).not.toHaveAttribute('aria-valuenow');
  });
});

describe('EmptyState', () => {
  it('shows one phrase, an optional reason and one action', () => {
    const onClick = vi.fn();
    render(<EmptyState title="Пока тихо. Скажи первую мысль, я разложу её." action={<Button variant="primary" onClick={onClick}>Записать</Button>} />);
    expect(screen.getByText(/Пока тихо/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Записать' }));
    expect(onClick).toHaveBeenCalled();
  });

  it('the illustration is decorative', () => {
    const { container } = render(<EmptyState title="Пусто" />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('ring: places the dots clockwise from the top and fills the first `value`', () => {
    const dots = ringDots(4, 1, 10, 50, 50);
    expect(dots).toEqual([
      { x: 50, y: 40, filled: true },
      { x: 60, y: 50, filled: false },
      { x: 50, y: 60, filled: false },
      { x: 40, y: 50, filled: false },
    ]);
    expect(ringDots(3, 99, 10, 0, 0).every((d) => d.filled)).toBe(true);
    expect(ringDots(0, 0, 10, 0, 0)).toEqual([]);
  });

  it('ring illustration prints the honest counter', () => {
    const { container } = render(<EmptyState illustration="ring" progress={{ value: 6, total: 14 }} title="Паттерны появятся после 14 записей. Сейчас 6." />);
    expect(container.querySelector('svg text')).toHaveTextContent('6/14');
    expect(container.querySelectorAll('svg circle')).toHaveLength(14);
  });
});

describe('Skeleton', () => {
  it('announces loading once through its label and draws the requested lines', () => {
    const { container } = render(<Skeleton lines={3} label="Загружаю записи" />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Загружаю записи')).toBeInTheDocument();
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(3);
  });
});
