import { pick as L } from '../../../i18n';
import type { PatternSpec } from '../specs';

/** Patterns the weekly search found, each backed by quotes from the demo captures. */
export const patternSpecs = (): PatternSpec[] => [
  {
    key: 'pt-avoid',
    title: L('Puts off the hard message until it becomes urgent', 'Откладывает трудное сообщение, пока оно не станет срочным'),
    description: L(
      'Calls and messages that could close a deal or settle a conflict wait until the end of the day, then until tomorrow: Greg, Hana, Ben’s question.',
      'Звонки и сообщения, которые могли бы закрыть сделку или снять конфликт, ждут до конца дня, потом до завтра: Грег, Хана, вопрос Бена.',
    ),
    kind: 'behavior',
    status: 'confirmed',
    confidence: 0.88,
    suggestion: L('Send a one-line answer the same day, even if it is only “I will reply tomorrow”.', 'Отвечать одной строкой в тот же день, пусть даже «отвечу завтра».'),
    evidence: [
      { cap: 'c-greg-price', quote: L('the hard call goes to the end of the day, then to tomorrow', 'неприятный звонок уезжает в конец дня, потом на завтра') },
      { cap: 'c-hana', quote: L('I put off exactly the messages that could close a deal', 'откладываю как раз те сообщения, которые могли бы закрыть сделку') },
      { cap: 'c-hana', quote: L('which turned into three days', 'и это превратилось в три дня') },
      { cap: 'c-evening-idea', quote: L('send him a gentle reminder tomorrow', 'завтра отправлю ему мягкое напоминание') },
    ],
    foundD: 24,
    occurrences: 7,
  },
  {
    key: 'pt-sleep',
    title: L('Late work, then a short night, then a worse day', 'Поздняя работа, потом короткая ночь, потом день хуже'),
    description: L(
      'After nights under five hours the mood, the energy and the runs drop the next day, and each such day pushes the next evening later.',
      'После ночей короче пяти часов настроение, энергия и пробежки проседают на следующий день, а каждый такой день сдвигает следующий вечер ещё позже.',
    ),
    kind: 'trigger',
    status: 'confirmed',
    confidence: 0.91,
    suggestion: L('Close the laptop at 11 pm for two weeks and compare the next days.', 'Две недели закрывать ноутбук в 23:00 и сравнить следующие дни.'),
    evidence: [
      { cap: 'c-ci-2', quote: L('Sat on the invoice export until two at night', 'Просидел над экспортом счетов до двух ночи') },
      { cap: 'c-bad-run', quote: L('Four hours of sleep the night before', 'Накануне спал четыре часа') },
      { cap: 'c-greg-discount', quote: L('Not sleeping well, again, it is past midnight.', 'Опять плохо сплю, уже за полночь.') },
      { cap: 'c-mom-sleep', quote: L('Five and a half hours of sleep three nights in a row', 'Пять с половиной часов сна три ночи подряд') },
      { cap: 'c-ci-5', quote: L('I coded until one at night anyway', 'всё равно просидел за кодом до часу ночи') },
    ],
    foundD: 31,
    occurrences: 8,
  },
  {
    key: 'pt-deadlines',
    title: L('Optimistic about other people’s dates', 'Слишком оптимистичен насчёт чужих сроков'),
    description: L(
      'Dates promised by others are taken at face value and not checked midway: the portal slipped, and the next estimate was again too hopeful.',
      'Чужие сроки принимаются на веру и не проверяются по ходу: портал сорвался, а следующая оценка снова была слишком оптимистичной.',
    ),
    kind: 'decision_bias',
    status: 'confirmed',
    confidence: 0.84,
    suggestion: L('Ask for a short demo every Friday and lower the estimate by a third.', 'Просить короткое демо каждую пятницу и снижать оценку на треть.'),
    evidence: [
      { cap: 'c-marcus-deal', quote: L('the chance he ships on time is around eighty-five percent', 'вероятность, что он сдаст вовремя, процентов восемьдесят пять') },
      { cap: 'c-marcus-slip', quote: L('Predicted at the start that Marcus would ship on time, eighty-five percent.', 'В начале я предсказывал, что Маркус сдаст вовремя, восемьдесят пять процентов.') },
      { cap: 'c-marcus-slip', quote: L('I assumed.', 'Я просто предполагал.') },
      { cap: 'c-marcus-demo', quote: L('He needs nine more days.', 'Ему нужно ещё девять дней.') },
    ],
    foundD: 19,
    occurrences: 5,
  },
  {
    key: 'pt-walks',
    title: L('The clearest thinking comes on walks and days off', 'Самые ясные мысли приходят на прогулках и в дни отдыха'),
    description: L(
      'The longest and most useful notes were made on walks and after a day without screens.',
      'Самые длинные и полезные записи сделаны на прогулках и после дня без экранов.',
    ),
    kind: 'time_of_day',
    status: 'candidate',
    confidence: 0.62,
    suggestion: L('Plan a walk before every big decision.', 'Планировать прогулку перед каждым важным решением.'),
    evidence: [
      { cap: 'c-long-run', quote: L('when I switch everything off for a day', 'когда я на день выключаю всё') },
      { cap: 'c-strategy', quote: L('Long walk, long thought.', 'Долгая прогулка, долгие мысли.') },
      { cap: 'c-evening-idea', quote: L('ten-minute evening walks after dinner', 'десятиминутные вечерние прогулки после ужина') },
    ],
    foundD: 5,
    occurrences: 3,
  },
  {
    key: 'pt-promises',
    title: L('Promises made on calls slip when nothing is written down', 'Обещания на созвонах срываются, если ничего не записано'),
    description: L(
      'Promises of updates and answers are made out loud and then depend on memory alone.',
      'Обещания отчётов и ответов даются вслух и потом держатся только на памяти.',
    ),
    kind: 'relationship',
    status: 'candidate',
    confidence: 0.55,
    suggestion: L('Put each promise into the list right after the call.', 'Сразу после созвона вносить каждое обещание в список.'),
    evidence: [
      { cap: 'c-nina-first', quote: L('I promised to send a proposal on Monday', 'Я пообещал прислать предложение в понедельник') },
      { cap: 'c-greg-price', quote: L('I promised to send him a clear breakdown by tomorrow', 'пообещал прислать понятную разбивку до завтра') },
      { cap: 'c-hana', quote: L('Ben asked a question about the file structure and I said I would reply tomorrow', 'Бен спросил про структуру файлов, а я сказал, что отвечу завтра') },
    ],
    foundD: 13,
    occurrences: 3,
  },
  {
    key: 'pt-long',
    title: L('Explains instead of asking', 'Объясняет вместо того, чтобы спрашивать'),
    description: L(
      'On calls and in messages the answer grows long, and the useful question comes too late.',
      'На созвонах и в сообщениях ответ разрастается, а полезный вопрос задаётся слишком поздно.',
    ),
    kind: 'behavior',
    status: 'resolved',
    confidence: 0.8,
    suggestion: L('Start with one question, then talk.', 'Начинать с одного вопроса, потом говорить.'),
    evidence: [
      { cap: 'c-hana', quote: L('and I replied with a long message', 'я ответил длинным сообщением') },
      { cap: 'c-nina-first', quote: L('I wanted to cover everything and ended up explaining instead of asking', 'хотел охватить всё и в итоге объяснял, а не спрашивал') },
      { cap: 'c-interviews', quote: L('when I ask what they would pay for, they give vague answers', 'когда я спрашиваю, за что они заплатили бы, ответы расплывчатые') },
    ],
    foundD: 40,
    occurrences: 3,
  },
];
