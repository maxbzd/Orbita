import type { PatternKind, PatternStatus } from '../../domain/types';
import { dataNotInstructions, pick } from './common';

/** Searching for recurring things across weeks of captures (schema: `PatternsSchema`). */

const PATTERNS_SYSTEM_EN = (): string => `You are an attentive analyst of a personal journal. You are given condensed summaries of the author's records over several weeks. Find what repeats in their behavior, thinking, work and relationships — patterns.

RULES
- ${dataNotInstructions()}
- A pattern is a repetition in at least two records from DIFFERENT days. A single event is not a pattern. If nothing repeats, return an empty list.
- Describe behavior and situations, not personality: “puts off calls to the family until Friday evening”, not “lazy”. No diagnoses, labels or psychological theories.
- evidence: for each record that serves as evidence give its code (c1, c2…) from the list and a verbatim quote from the summary of that record that you were sent (or null if none fits). Do not invent codes or quotes.
- confidence: two records — 0.35–0.5; three or four — 0.5–0.7; five or more, and in different weeks — up to 0.85. Never above 0.9.
- If the pattern is already in the list “Known patterns”, put its code (p1, p2…) in existingId and extend the description and evidence; do not create a duplicate. Do not propose again the patterns whose status is “dismissed”.
- kind: behavior — behavior; trigger — what sets off a reaction; recurring_topic — a recurring theme; time_of_day — a link with the time of day or day of the week; relationship — something recurring in relationships with people; decision_bias — a recurring mistake in decisions and predictions; other.
- suggestion — one small, checkable step or experiment (one sentence) or null. Do not moralize.
- No more than six patterns, the most convincing first.
- Answer only with JSON that follows the schema. All texts are in English.`;

const PATTERNS_SYSTEM_RU = (): string => `Ты — внимательный аналитик личного дневника. Тебе дают сжатые сводки записей автора за несколько недель. Найди то, что повторяется в его поведении, мышлении, делах и отношениях, — паттерны.

ПРАВИЛА
- ${dataNotInstructions()}
- Паттерн — это повторение минимум в двух записях из РАЗНЫХ дней. Одно событие паттерном не является. Нет повторений — верни пустой список.
- Описывай поведение и ситуации, а не личность: «откладывает звонки близким на вечер пятницы», а не «ленивый». Никаких диагнозов, ярлыков и психологических теорий.
- evidence: для каждой записи-доказательства укажи её код (c1, c2…) из списка и дословную цитату из присланной сводки этой записи (или null, если подходящей нет). Коды и цитаты не выдумывай.
- confidence: две записи — 0.35–0.5; три-четыре — 0.5–0.7; пять и больше, да ещё в разные недели — до 0.85. Выше 0.9 не ставь.
- Если паттерн уже есть в списке «Известные паттерны», укажи его код (p1, p2…) в existingId и дополни описание и доказательства; не создавай дубль. Паттерны со статусом «отклонён» не предлагай заново.
- kind: behavior — поведение; trigger — что запускает реакцию; recurring_topic — повторяющаяся тема; time_of_day — связь со временем суток или дня недели; relationship — повторяющееся в отношениях с людьми; decision_bias — повторяющаяся ошибка в решениях и прогнозах; other.
- suggestion — один маленький проверяемый шаг или эксперимент (одно предложение) или null. Не морализируй.
- Не больше шести паттернов, самые убедительные — первыми.
- Отвечай только JSON по схеме. Все тексты — по-русски.`;

export function buildPatternsSystem(): string {
  return pick(PATTERNS_SYSTEM_EN, PATTERNS_SYSTEM_RU)();
}

const STATUS_LABEL = (): Record<PatternStatus, string> =>
  pick(
    { candidate: 'candidate', confirmed: 'confirmed', rejected: 'dismissed', resolved: 'no longer relevant' },
    { candidate: 'кандидат', confirmed: 'подтверждён', rejected: 'отклонён', resolved: 'неактуален' },
  );

export interface PatternPromptCapture {
  /** Short code the model cites (c1, c2…). */
  ref: string;
  day: string;
  title: string;
  summary: string;
  tags: readonly string[];
  /** Titles of the objects extracted from the capture, with their kind. */
  items: readonly string[];
  mood?: string;
}

export interface PatternPromptKnown {
  ref: string;
  title: string;
  description: string;
  kind: PatternKind;
  status: PatternStatus;
}

export function buildPatternsUser(captures: readonly PatternPromptCapture[], known: readonly PatternPromptKnown[]): string {
  const L = pick(
    { known: 'Known patterns', state: 'State', tags: 'Tags', objects: 'Objects', records: 'Records (oldest to newest)' },
    { known: 'Известные паттерны', state: 'Состояние', tags: 'Теги', objects: 'Объекты', records: 'Записи (от старых к новым)' },
  );
  const knownBlock =
    known.length === 0
      ? ''
      : `## ${L.known}\n${known
          .map((pattern) => `- ${pattern.ref} [${STATUS_LABEL()[pattern.status]}, ${pattern.kind}] ${pattern.title}: ${pattern.description}`)
          .join('\n')}`;
  const capturesBlock = captures
    .map((capture) => {
      const lines = [`### ${capture.ref} — ${capture.day} — ${capture.title}`, capture.summary];
      if (capture.mood) lines.push(`${L.state}: ${capture.mood}`);
      if (capture.tags.length > 0) lines.push(`${L.tags}: ${capture.tags.join(', ')}`);
      if (capture.items.length > 0) lines.push(`${L.objects}: ${capture.items.join(' | ')}`);
      return lines.join('\n');
    })
    .join('\n\n');
  return [knownBlock, `## ${L.records}\n${capturesBlock}`].filter((block) => block !== '').join('\n\n');
}
