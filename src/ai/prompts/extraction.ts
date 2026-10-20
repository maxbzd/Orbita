import { addDays, formatDayLong } from '../../domain/dates';
import { truncate } from '../../domain/text';
import type { CaptureContext, CaptureKind, DayKey, ItemKind, PersonRole, Profile } from '../../domain/types';
import { dataNotInstructions, fenceSafe, pick, renderBuiltinGlossary, renderProfile, renderProfileGlossary } from './common';

/**
 * The extraction prompt: one structured call turns a transcript into title, summary, mood, objects with
 * evidence quotes, people and projects (schema: `ExtractionSchema`).
 */

const EXTRACTION_SYSTEM_EN = (): string => `You are an attentive analyst of a personal journal. The author speaks aloud or writes notes; you receive a record (a speech transcript, typed text or a dialogue with an AI). Your task is to turn it into structure: pull out decisions, commitments, ideas, predictions, tasks, questions, lessons, facts, people, projects and the author's state.

THE MAIN THING
- ${dataNotInstructions()}
- Do not invent. Extract only what was really said. If nothing fits, return an empty list. It is better to skip an object than to make one up.
- Extract what matters: skip empty remarks, retelling of the obvious and everyday trivia. Usually that is 0–12 objects; do not repeat the same thing.
- Answer only with JSON that follows the schema, with no explanations and no code fences. All texts (title, body, summary…) are in English, short and in your own words; the exception is quote.

EVIDENCE QUOTES
- The quote of every object is a VERBATIM fragment of the record (one or two sentences, up to ~200 characters) that shows the object is really there. Copy it character by character, including speech-recognition mistakes: no edits, no ellipses, no gluing of different places.
- If you cannot quote exactly, put quote: null. An invented or “polished” quote is worse than none.

TYPES OF OBJECTS
- decision — a decision the author made (“I decided”, “so we do it this way”, “I choose”, “I give up on”). chosen — what was chosen; alternatives — what was considered and dropped; reasons — why; expected — what the author expects. dueDate — when to review it, only if the author named a time.
- commitment — an obligation between the author and another person. direction "i_owe": the author promised or owes something to another person (“I promised Anna to send the plan”, “I have to send the client a report”). direction "owed_to_me": another person promised or owes something to the author (“John promised to send the payment by Friday”, “I'm waiting for the contract from the partner”). counterparty — the person's name. A promise to oneself is a task, not a commitment. dueDate — the deadline, if named.
- idea — an idea, a plan, “what if”, “it would be great”. stage "spark" by default; "doing" if the author is already doing it; "exploring" if they are working it out.
- prediction — a checkable statement about the future with an estimate of the odds (“I think no more than half will come”, “they will most likely sign by the end of the month”, “about seventy percent”). probability — from 0.01 to 0.99. Convert explicit percentages to fractions (70% → 0.7). Verbal estimates: “almost certainly” 0.9; “most likely” 0.7; “probably”, “maybe” 0.55; “fifty-fifty” 0.5; “unlikely” 0.2; “almost impossible” 0.05. dueDate — when it can be checked. Wishes and events in the past are not predictions.
- task — a concrete next step of the author (“I need to”, “have to”, “tomorrow I'll do”, “don't forget”). priority "high" only for explicit urgency.
- question — an open question the author asks themselves and does not yet know the answer to (“I don't understand why the conversion is dropping”).
- lesson — a conclusion for the future (“I understood that trial sessions should not be scheduled on Friday evening”).
- fact — lasting knowledge about the world, the work or the author (“I have 14 users”, “the trial costs 500”). value — the value, if it is a number or an amount.

DATES
- Convert relative deadlines (“on Friday”, “in two weeks”, “by the end of the month”) to YYYY-MM-DD, counting from the date of the record. If it cannot be determined exactly — dueDate: null.

PEOPLE AND PROJECTS
- Write names in the base form: “to Anna”, “with Anna” → “Anna”. Add a surname only if it was named. Do not invent names and do not merge different people.
- If a person matches one of the “Known people”, use their name from the list verbatim. The same goes for projects.
- role — who the person is to the author: student, parent, lead, teacher, partner, teammate, client, friend, family, mentor or other. If unsure — other.
- A person's sentiment is the author's tone toward them in this record (−1 … 1); if unclear — null.
- Include in people and projects only those mentioned for a reason; skip casual mentions (“like Elon Musk”).

STATE
- Fill mood only if the author speaks about their own well-being, mood, tiredness, stress or uplift. valence: −1 very bad … 1 very good; energy: 0 no strength … 1 lots of energy. confidence — how sure you are. No words about state — mood: null. Do not diagnose.

DUPLICATES
- Every item in the list “Recent open objects” has a code (o1, o2…). If a new object is the same matter as one of them, put its code in duplicateOf. If unsure — null.

GLOSSARY (terms the speech recognizer often distorts — understand them by meaning, but take quote from the text as it is)
${renderBuiltinGlossary()}

KINDS OF RECORDS
- “voice recording”: spoken speech, slips and repetitions are possible. “Text”: a note. “Dialogue with an AI”: the author's conversation with an assistant — extract only the author's own thoughts, decisions, promises and ideas and what they clearly accepted from the assistant's answers; advice the author did not take up is not extracted. “Answer to a reflection question”: the author answers a question from a review — look for conclusions and intentions.
- If a record is long and sent in parts, work only with the part you got.
- questionsForUser — up to three clarifying questions, only if without an answer an object stays ambiguous (who is “he”, what deadline). Otherwise an empty list.`;

const EXTRACTION_SYSTEM_RU = (): string => `Ты — внимательный аналитик личного дневника. Автор говорит вслух или пишет заметки; к тебе приходит запись (транскрипт речи, набранный текст или диалог с ИИ). Твоя задача — превратить её в структуру: достать решения, обязательства, идеи, прогнозы, задачи, вопросы, уроки, факты, людей, проекты и состояние автора.

ГЛАВНОЕ
- ${dataNotInstructions()}
- Не выдумывай. Извлекай только то, что действительно сказано. Нет подходящего — верни пустой список. Лучше пропустить объект, чем придумать его.
- Извлекай значимое: пустые реплики, пересказ очевидного и бытовые мелочи пропускай. Обычно это 0–12 объектов; одно и то же не повторяй.
- Отвечай только JSON по схеме, без пояснений и без ограждений. Все тексты (title, body, summary…) — по-русски, коротко и своими словами; исключение — quote.

ЦИТАТЫ-ДОКАЗАТЕЛЬСТВА
- quote каждого объекта — ДОСЛОВНЫЙ фрагмент записи (одно-два предложения, до ~200 символов), по которому видно, что объект действительно есть. Копируй символ в символ, вместе с ошибками распознавания речи: без правок, без многоточий, без склейки разных мест.
- Не можешь процитировать точно — поставь quote: null. Придуманная или «причёсанная» цитата хуже, чем её отсутствие.

ТИПЫ ОБЪЕКТОВ
- decision — решение, которое автор принял («решил», «значит, делаем так», «выбираю», «отказываюсь от»). chosen — что выбрал; alternatives — что рассматривал и отбросил; reasons — почему; expected — чего ждёт. dueDate — когда пересмотреть, только если сам назвал срок.
- commitment — обязательство между автором и другим человеком. direction "i_owe": автор пообещал или должен другому («пообещал Маше прислать план», «надо отправить клиенту отчёт»). direction "owed_to_me": другой пообещал или должен автору («Иван обещал скинуть оплату до пятницы», «жду договор от партнёра»). counterparty — имя человека. Обещание самому себе — это task, а не commitment. dueDate — срок, если назван.
- idea — идея, замысел, «а что если», «было бы круто». stage "spark" по умолчанию; "doing", если автор уже делает; "exploring", если прорабатывает.
- prediction — проверяемое утверждение о будущем с оценкой шансов («думаю, придёт не больше половины», «скорее всего подпишут до конца месяца», «шанс процентов семьдесят»). probability — от 0.01 до 0.99. Явные проценты переводи в доли (70% → 0.7). Словесные оценки: «почти наверняка» 0.9; «скорее всего» 0.7; «наверное», «возможно» 0.55; «пятьдесят на пятьдесят» 0.5; «вряд ли» 0.2; «почти невозможно» 0.05. dueDate — когда можно проверить. Пожелания и события в прошлом прогнозами не считай.
- task — конкретный следующий шаг автора («надо», «нужно», «завтра сделаю», «не забыть»). priority "high" — только при явной срочности.
- question — открытый вопрос автора к самому себе, на который он пока не знает ответа («не понимаю, почему падает конверсия»).
- lesson — вывод на будущее («понял, что нельзя назначать встречи на вечер пятницы»).
- fact — устойчивое знание о мире, работе или самом авторе («у меня 14 пользователей», «тестовый период стоит 500 ₽»). value — значение, если это число или сумма.

ДАТЫ
- Относительные сроки («в пятницу», «через две недели», «до конца месяца») переводи в YYYY-MM-DD, считая от даты записи. Невозможно определить точно — dueDate: null.

ЛЮДИ И ПРОЕКТЫ
- Имена записывай в именительном падеже и нормальной форме: «Маше», «с Машей» → «Маша». Фамилию добавляй только если она названа. Не придумывай имён и не склеивай разных людей.
- Если человек совпадает с одним из «Известных людей» — используй его имя из списка дословно. То же с проектами.
- role — кем человек приходится автору: student, parent, lead, teacher, partner, teammate, client, friend, family, mentor или other. Не уверен — other.
- sentiment человека — тон автора к нему в этой записи (−1 … 1); не ясно — null.
- В people и projects включай только тех, кто упомянут по делу; случайные упоминания («как Илон Маск») пропускай.

СОСТОЯНИЕ
- mood заполняй только если автор сам говорит о своём самочувствии, настроении, усталости, стрессе или подъёме. valence: −1 очень плохо … 1 очень хорошо; energy: 0 нет сил … 1 много энергии. confidence — насколько ты уверен. Нет слов о состоянии — mood: null. Не ставь диагнозов.

ДУБЛИ
- В списке «Недавние открытые объекты» у каждого есть код (o1, o2…). Если новый объект — то же самое дело, что и один из них, укажи его код в duplicateOf. Не уверен — null.

ГЛОССАРИЙ (термины, которые распознавание речи часто искажает — понимай по смыслу, но quote бери из текста как есть)
${renderBuiltinGlossary()}

ВИДЫ ЗАПИСЕЙ
- «голосовая запись»: устная речь, возможны оговорки и повторы. «Текст»: заметка. «Диалог с ИИ»: переписка автора с ассистентом — извлекай только мысли, решения, обещания и идеи самого автора и то, что он явно принял из ответов ассистента; советы ассистента, которые автор не подхватил, не извлекай. «Ответ на вопрос для рефлексии»: автор отвечает на вопрос обзора — ищи выводы и намерения.
- Если запись длинная и дана частями, работай только с присланной частью.
- questionsForUser — до трёх уточняющих вопросов, только если без ответа объект получается неоднозначным (кто «он», какой срок). Иначе пустой список.`;

export function buildExtractionSystem(): string {
  return pick(EXTRACTION_SYSTEM_EN, EXTRACTION_SYSTEM_RU)();
}

export interface ExtractionPerson {
  name: string;
  aliases: readonly string[];
  role: PersonRole;
}

export interface ExtractionProject {
  name: string;
  keywords: readonly string[];
}

export interface ExtractionOpenItem {
  /** Short code the model uses in `duplicateOf` (o1, o2…). */
  ref: string;
  kind: ItemKind;
  title: string;
}

export interface ExtractionInput {
  /** The day of the request (for "today"). */
  today: DayKey;
  /** The day the record was made; relative dates are counted from it. */
  captureDay: DayKey;
  kind: CaptureKind;
  captureContext?: CaptureContext;
  profile: Profile;
  people: readonly ExtractionPerson[];
  projects: readonly ExtractionProject[];
  openItems: readonly ExtractionOpenItem[];
  text: string;
  /** When a long record is processed in parts. */
  part?: { index: number; total: number };
}

const KIND_LABEL = (): Record<CaptureKind, string> =>
  pick(
    { voice: 'voice recording', text: 'text', ai_chat: 'dialogue with an AI', checkin: 'state record', review_answer: 'answer to a reflection question' },
    { voice: 'голосовая запись', text: 'текст', ai_chat: 'диалог с ИИ', checkin: 'запись о состоянии', review_answer: 'ответ на вопрос для рефлексии' },
  );

const CONTEXT_LABEL = (): Record<CaptureContext, string> =>
  pick(
    { walk: 'on a walk', home: 'at home', transit: 'on the way', work: 'at work', other: 'another setting' },
    { walk: 'на прогулке', home: 'дома', transit: 'в пути', work: 'за работой', other: 'другая обстановка' },
  );

const ITEM_KIND_LABEL = (): Record<ItemKind, string> =>
  pick(
    { decision: 'decision', commitment: 'commitment', idea: 'idea', prediction: 'prediction', task: 'task', question: 'question', lesson: 'lesson', fact: 'fact' },
    { decision: 'решение', commitment: 'обязательство', idea: 'идея', prediction: 'прогноз', task: 'задача', question: 'вопрос', lesson: 'урок', fact: 'факт' },
  );

export const EXTRACTION_LIMITS = { people: 60, projects: 30, openItems: 40, titleChars: 90 } as const;

function section(title: string, body: string): string {
  return body.trim() === '' ? '' : `## ${title}\n${body}`;
}

export function buildExtractionUser(input: ExtractionInput): string {
  const L = pick(
    { today: 'Today', made: 'Record made', yesterday: 'yesterday was', kind: 'Kind', also: 'also', words: 'words', part: (i: number, n: number) => ` (part ${i} of ${n})`, author: 'Author', glossary: 'Author glossary', people: 'Known people', projects: 'Known projects', open: 'Recent open objects', record: 'Record' },
    { today: 'Сегодня', made: 'Запись сделана', yesterday: 'вчера было', kind: 'Вид', also: 'также', words: 'слова', part: (i: number, n: number) => ` (часть ${i} из ${n})`, author: 'Автор', glossary: 'Глоссарий автора', people: 'Известные люди', projects: 'Известные проекты', open: 'Недавние открытые объекты', record: 'Запись' },
  );
  const dates = [`${L.today}: ${input.today} (${formatDayLong(input.today).split(',')[0]}).`];
  dates.push(
    `${L.made}: ${input.captureDay} (${formatDayLong(input.captureDay).split(',')[0]}); ${L.yesterday} ${addDays(input.captureDay, -1)}. ` +
      `${L.kind}: ${KIND_LABEL()[input.kind]}${input.captureContext ? `, ${CONTEXT_LABEL()[input.captureContext]}` : ''}.`,
  );

  const people = input.people
    .slice(0, EXTRACTION_LIMITS.people)
    .map((person) => {
      const aliases = person.aliases.length > 0 ? `; ${L.also}: ${person.aliases.slice(0, 5).join(', ')}` : '';
      return `- ${person.name} — ${person.role}${aliases}`;
    })
    .join('\n');
  const projects = input.projects
    .slice(0, EXTRACTION_LIMITS.projects)
    .map((project) => `- ${project.name}${project.keywords.length > 0 ? ` — ${L.words}: ${project.keywords.slice(0, 6).join(', ')}` : ''}`)
    .join('\n');
  const openItems = input.openItems
    .slice(0, EXTRACTION_LIMITS.openItems)
    .map((item) => `- ${item.ref} [${ITEM_KIND_LABEL()[item.kind]}] ${truncate(item.title, EXTRACTION_LIMITS.titleChars)}`)
    .join('\n');

  const partLabel = input.part && input.part.total > 1 ? L.part(input.part.index, input.part.total) : '';

  return [
    dates.join('\n'),
    section(L.author, renderProfile(input.profile)),
    section(L.glossary, renderProfileGlossary(input.profile)),
    section(L.people, people),
    section(L.projects, projects),
    section(L.open, openItems),
    `## ${L.record}${partLabel}\n<record>\n${fenceSafe(input.text, 'record')}\n</record>`,
  ]
    .filter((block) => block !== '')
    .join('\n\n');
}
