export type PluralForms = readonly [one: string, few: string, many: string];

/** Russian plural form for `count`: `pluralRu(2, ['день', 'дня', 'дней'])` → `дня`. */
export function pluralRu(count: number, [one, few, many]: PluralForms): string {
  const n = Math.abs(Math.trunc(count));
  const lastTwo = n % 100;
  const last = n % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

/** `countRu(5, ['запись', 'записи', 'записей'])` → `5 записей`. */
export function countRu(count: number, forms: PluralForms): string {
  return `${count} ${pluralRu(count, forms)}`;
}
