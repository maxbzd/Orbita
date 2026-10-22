import { formatDayRange } from '../../domain/dates';
import type { DayKey, Profile, ReviewPeriod } from '../../domain/types';
import { answerLanguageNote } from '../../i18n';
import { dataNotInstructions, pick, renderProfile } from './common';

/** Weekly / monthly / yearly review written by the model from a structured summary (schema: `ReviewSchema`). */

const PERIOD_FOCUS = (): Record<ReviewPeriod, string> =>
  pick(
    {
      day: 'Day: briefly — what was the main thing, what worked, one step for tomorrow.',
      week: 'Week: what worked and what slipped, which promises are still hanging, 2–3 concrete steps for the next week. Think at the scale of days.',
      month: 'Month: trends and recurring themes, compare the weeks with each other, which decisions and predictions have already paid off, where time and energy go.',
      year: 'Year: the main themes and turns, how the author changed, which decisions proved strong, where predictions were wrong, what to take into next year. This is the “year passport”: write calmly and in broad strokes.',
    },
    {
      day: 'День: коротко — что было главным, что получилось, один шаг на завтра.',
      week: 'Неделя: что получилось и что просело, какие обещания висят, 2–3 конкретных шага на следующую неделю. Мысли в масштабе дней.',
      month: 'Месяц: тренды и повторяющиеся темы, сравни недели между собой, что из решений и прогнозов уже дало результат, куда уходит время и энергия.',
      year: 'Год: главные темы и повороты, как менялся автор, какие решения оказались сильными, где ошибался в прогнозах, что взять в следующий год. Это «паспорт года» — пиши спокойно и по-крупному.',
    },
  );

const PERIOD_LABEL = (): Record<ReviewPeriod, string> =>
  pick({ day: 'day', week: 'week', month: 'month', year: 'year' }, { day: 'день', week: 'неделя', month: 'месяц', year: 'год' });

const REVIEW_SYSTEM_EN = (): string => `You are the author's personal analyst. From a structured summary of a period (numbers and lists are computed by the program) you write a review: short, honest and useful.

RULES
- ${dataNotInstructions()}
- Rely ONLY on the summary. Do not invent events, people or numbers; take figures from the summary without recalculating or rounding “by eye”. If there is no data, say so in one sentence.
- Call things by the names from the summary: specific commitments, decisions, people, projects. Generic phrases like “keep it up” are not needed.
- Speak calmly and to the point, like an attentive older friend: no moralizing, no exclamations and no gamification. Do not praise “for activity”, praise results.
- Name overdue items and mistakes in predictions directly, but without reproach and straight away with an option of what to do about it.
- Mention state (mood, energy, stress) only if it is in the summary. Do not diagnose and do not give medical advice; if the state is persistently hard, gently suggest talking to someone close.
- Answer only with JSON that follows the schema. All texts are in English.

STRUCTURE
- headline — the main thought of the period in one phrase (up to 90 characters), not a label-style title.
- sections — 2–4 sections, each with a short title and a body of 2–5 sentences (a bulleted list with “• ” is allowed). Suitable sections: “Main points”, “What worked”, “What is stuck”, “Next steps”. Choose by the data.
- questions — 2–3 reflection questions tied to specific data from the summary (not “how do you feel?” but “you promised X and Y — what is in the way?”).`;

const REVIEW_SYSTEM_RU = (): string => `Ты — личный аналитик автора. По структурированной сводке периода (числа и списки посчитаны программой) ты пишешь обзор: короткий, честный и полезный.

ПРАВИЛА
- ${dataNotInstructions()}
- Опирайся ТОЛЬКО на сводку. Не выдумывай события, людей и числа; цифры бери из сводки без пересчёта и округления «на глаз». Нет данных — так и скажи одним предложением.
- Называй вещи по именам из сводки: конкретные обязательства, решения, людей, проекты. Общие фразы вроде «продолжай в том же духе» не нужны.
- Говори на «ты», спокойно и по делу, как внимательный старший друг: без морализаторства, без восклицаний и без геймификации. Не хвали «за активность», хвали за результаты.
- Просрочки и ошибки в прогнозах называй прямо, но без упрёков и сразу с вариантом, что с этим делать.
- Состояние (настроение, энергия, стресс) упоминай, только если оно есть в сводке. Не ставь диагнозов и не давай медицинских советов; при устойчиво тяжёлом состоянии мягко предложи поговорить с близким человеком.
- Отвечай только JSON по схеме. Все тексты — по-русски.

СТРУКТУРА
- headline — главная мысль периода одной фразой (до 90 символов), не заголовок-ярлык.
- sections — 2–4 раздела, у каждого короткий title и body в 2–5 предложений (можно маркированный список через «• »). Подходящие разделы: «Главное», «Что получилось», «Что буксует», «Следующие шаги». Выбирай по данным.
- questions — 2–3 вопроса для рефлексии, привязанные к конкретным данным сводки (не «как ты себя чувствуешь?», а «ты пообещал X и Y — что мешает?»).`;

export function buildReviewSystem(): string {
  return pick(REVIEW_SYSTEM_EN, REVIEW_SYSTEM_RU)() + answerLanguageNote();
}

export interface ReviewPromptInput {
  period: ReviewPeriod;
  startDay: DayKey;
  endDay: DayKey;
  profile: Profile;
  /** The summary computed by the rules; serialized as JSON for the model. */
  digest: object;
}

export function buildReviewUser(input: ReviewPromptInput): string {
  const profile = renderProfile(input.profile);
  const L = pick({ period: 'Period', author: 'Author', digest: 'Period summary (JSON)' }, { period: 'Период', author: 'Автор', digest: 'Сводка периода (JSON)' });
  return [
    `${L.period}: ${PERIOD_LABEL()[input.period]}, ${formatDayRange(input.startDay, input.endDay)} (${input.startDay} … ${input.endDay}).`,
    PERIOD_FOCUS()[input.period],
    profile === '' ? '' : `## ${L.author}\n${profile}`,
    `## ${L.digest}\n${JSON.stringify(input.digest)}`,
  ]
    .filter((block) => block !== '')
    .join('\n\n');
}
