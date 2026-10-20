import { pick as L } from '../../../i18n';
import type { CheckInSpec, StoryBeats } from '../specs';

/**
 * Check-ins that belong to a capture: typed `checkin` notes (manual) and states the AI read out of
 * voice notes (confirmed by the user, except the freshest ones, which wait for confirmation).
 */
export const captureCheckIns = (): CheckInSpec[] => [
  { cap: 'c-mentor-1', after: 3, valence: 0.7, energy: 0.75, focus: 0.7, stress: 0.2, tags: L(['mentor', 'money'], ['ментор', 'деньги']), note: L('Clear head, a good conversation.', 'Ясная голова, хороший разговор.'), origin: 'ai_confirmed' },
  { cap: 'c-ci-1', after: 1, valence: -0.2, energy: 0.35, focus: 0.4, stress: 0.7, sleepHours: 5, tags: L(['sleep', 'studio'], ['сон', 'студия']), note: L('Heavy head, a deadline tomorrow.', 'Голова тяжёлая, завтра дедлайн.'), origin: 'manual' },
  { cap: 'c-greg-price', after: 4, valence: -0.5, energy: 0.4, focus: 0.35, stress: 0.75, tags: L(['money', 'client'], ['деньги', 'клиент']), note: L('An unpleasant talk about the price.', 'Неприятный разговор про цену.'), origin: 'ai_confirmed' },
  { cap: 'c-ci-2', after: 1, valence: -0.35, energy: 0.3, focus: 0.35, stress: 0.75, sleepHours: 4.5, tags: L(['sleep', 'release'], ['сон', 'релиз']), note: L('Coffee does not help.', 'Кофе не помогает.'), origin: 'manual' },
  { cap: 'c-bad-run', after: 3, valence: -0.6, energy: 0.25, focus: 0.3, stress: 0.8, sleepHours: 4, tags: L(['running', 'sleep'], ['бег', 'сон']), note: L('Annoyed about the short night.', 'Обидно из-за короткой ночи.'), origin: 'ai_confirmed' },
  { cap: 'c-marcus-slip', after: 3, valence: -0.45, energy: 0.5, focus: 0.5, stress: 0.7, tags: L(['team', 'deadline'], ['команда', 'срок']), note: L('Angry about the missed date.', 'Злой на сорванный срок.'), origin: 'ai_confirmed' },
  { cap: 'c-ci-3', after: 1, valence: -0.25, energy: 0.4, focus: 0.45, stress: 0.65, sleepHours: 5.5, tags: L(['sleep', 'team'], ['сон', 'команда']), origin: 'manual' },
  { cap: 'c-long-run', after: 2, valence: 0.7, energy: 0.7, focus: 0.6, stress: 0.1, tags: L(['friends', 'sport'], ['друзья', 'спорт']), note: L('Breathed out after the run.', 'Выдохнул после пробежки.'), origin: 'ai_confirmed' },
  { cap: 'c-ci-4', after: 1, valence: 0.65, energy: 0.8, focus: 0.75, stress: 0.2, sleepHours: 8, tags: L(['sleep'], ['сон']), note: L('Rested, I want to build.', 'Выспался, хочется делать.'), origin: 'manual' },
  { cap: 'c-nina-review', after: 3, valence: 0.9, energy: 0.85, focus: 0.8, stress: 0.1, tags: L(['studio', 'sales'], ['студия', 'продажи']), note: L('Nina approved the identity.', 'Нина утвердила стиль.'), origin: 'ai_confirmed' },
  { cap: 'c-mom-sleep', after: 3, valence: -0.15, energy: 0.4, focus: 0.45, stress: 0.5, sleepHours: 5.5, tags: L(['family', 'sleep'], ['семья', 'сон']), note: L('Awkward, but Mom is right.', 'Неловко, но мама права.'), origin: 'ai_confirmed' },
  { cap: 'c-strategy', after: 3, valence: 0.25, energy: 0.55, focus: 0.7, stress: 0.45, tags: L(['strategy'], ['стратегия']), origin: 'ai_confirmed' },
  { cap: 'c-ci-5', after: 1, valence: -0.1, energy: 0.35, focus: 0.4, stress: 0.7, sleepHours: 5, tags: L(['sleep', 'deadline', 'family'], ['сон', 'срок', 'семья']), note: L('Broke the promise to Mom.', 'Нарушил обещание маме.'), origin: 'manual' },
  { cap: 'c-evening-idea', after: 3, valence: 0.3, energy: 0.45, focus: 0.5, stress: 0.4, tags: L(['sleep', 'ideas'], ['сон', 'идеи']), origin: 'ai_suggested' },
  { cap: 'c-today-walk', after: 3, valence: 0.6, energy: 0.7, focus: 0.65, stress: 0.25, tags: L(['sales'], ['продажи']), note: L('640 subscribers, a good mood.', '640 подписчиков, настроение хорошее.'), origin: 'ai_suggested' },
  { cap: 'c-ci-6', after: 1, valence: 0.55, energy: 0.65, focus: 0.6, stress: 0.35, sleepHours: 6.5, tags: L(['sleep', 'sales'], ['сон', 'продажи']), note: L('A bit tense because of Hana.', 'Немного тревожно из-за Ханы.'), origin: 'manual' },
];

/** Days (ago) that shape the generated check-ins: pressure, good news and short nights. */
export const STORY_BEATS: StoryBeats = {
  deadlines: [48, 47, 33, 32, 31, 22, 21, 20, 17, 16, 14, 4, 3],
  wins: [55, 53, 46, 41, 38, 36, 30, 28, 23, 20, 12, 9, 7, 6, 1],
  shortNights: [
    [50, 49],
    [35, 31],
    [21, 19],
    [5, 3],
  ],
};

/** Short notes for generated check-ins, by what the day was like. */
export const checkinNotes = () => ({
  poorSleep: L(
    ['Slept little, everything falls out of my hands.', 'Foggy head, coffee does not help.', 'Sat up late and regretted it in the morning.', 'My eyes close during the call.'],
    ['Мало спал, всё валится из рук.', 'Голова ватная, кофе не помогает.', 'Сидел допоздна, утром пожалел.', 'Глаза слипаются на созвоне.'],
  ),
  pressure: L(
    ['Deadlines press, but I hold on.', 'A lot of unanswered messages from clients.', 'Anxious before tomorrow.', 'So much at once, I do not know where to begin.'],
    ['Сроки давят, но держусь.', 'Много неотвеченных сообщений от клиентов.', 'Тревожно перед завтрашним днём.', 'Столько всего сразу, не знаю, с чего начать.'],
  ),
  good: L(
    ['A good day: a payment arrived.', 'A customer wrote a warm message.', 'Got done what I kept postponing.', 'A user figured it out on their own, nice.'],
    ['Хороший день: пришла оплата.', 'Клиент написал тёплое сообщение.', 'Получилось то, что откладывал.', 'Пользователь сам во всём разобрался, приятно.'],
  ),
  neutral: L(
    ['An ordinary working day.', 'Calm, worked on the portal.', 'Walked in the evening, felt lighter.', 'The day went evenly, nothing special.', 'Studio work, then Lumen, then reports.'],
    ['Обычный рабочий день.', 'Спокойно, занимался порталом.', 'Вечером погулял, стало легче.', 'День прошёл ровно, ничего особенного.', 'Студия, потом Lumen, потом отчёты.'],
  ),
});

export const checkinTags = () => ({
  poorSleep: L(['sleep'], ['сон']),
  pressure: L(['deadline'], ['срок']),
  good: L(['sales'], ['продажи']),
  neutral: L(['work', 'studio', 'walk'], ['работа', 'студия', 'прогулка']),
});
