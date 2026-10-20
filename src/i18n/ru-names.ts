/** Russian-only name inflection. Other languages show names as written. */
import { getLocale } from './index';

/**
 * “перед Фёдором” (English “before Fyodor”) needs the instrumental case. A name the heuristic cannot decline stays as written:
 * “Анной” is right for most feminine names, “Фёдором” for masculine ones, and anything else is left alone.
 */
export function instrumentalName(name: string): string {
  if (getLocale() !== 'ru') return name;
  const [first = '', ...rest] = name.trim().split(/\s+/);
  const tail = rest.length > 0 ? ` ${rest.join(' ')}` : '';
  return `${instrumental(first)}${tail}`;
}

function instrumental(word: string): string {
  const lower = word.toLowerCase();
  if (lower.length < 3) return word;
  if (/[а-яё]$/i.test(word) === false) return word;
  const soft = (stem: string, ending: string): string => `${stem}${ending}`;
  if (lower.endsWith('ия')) return soft(word.slice(0, -2), 'ией');
  if (lower.endsWith('ей')) return soft(word.slice(0, -2), 'еем');
  if (lower.endsWith('й')) return soft(word.slice(0, -1), 'ем');
  if (lower.endsWith('ь')) return soft(word.slice(0, -1), 'ем');
  if (/[жчшщц]а$/.test(lower)) return soft(word.slice(0, -1), 'ей');
  if (lower.endsWith('а')) return soft(word.slice(0, -1), 'ой');
  if (lower.endsWith('я')) return soft(word.slice(0, -1), 'ей');
  if (/[бвгджзклмнпрстфхцчшщ]$/.test(lower)) return /[жчшщц]$/.test(lower) ? `${word}ем` : `${word}ом`;
  return word;
}
