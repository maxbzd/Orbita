import { pick as L } from '../../../i18n';

/**
 * Static pieces of the two weekly reviews. The numbers and lists inside a review are computed from the
 * seeded records (see `reviews.ts`); only the narrative anchors and the user's answers are written here.
 * The anchors are captures that fall into the reviewed week whatever day of the week "now" is.
 */

export interface DemoReviewContent {
  /** Which closed week: 2 = the one before last, 1 = the last complete one. */
  weeksBack: 1 | 2;
  generatedBy: 'ai' | 'rules';
  /** A capture that is always inside the week; its title seeds the headline. */
  anchorCap: string;
  headlineLead: string;
  /** A sentence in the "Main points" section tied to the anchor capture. */
  anchorText: string;
  questions: readonly string[];
  /** Answers by question index; the rest stay open. */
  answers: readonly { question: number; title: string; text: string }[];
}

export const reviewContent = (): DemoReviewContent[] => [
  {
    weeksBack: 2,
    generatedBy: 'rules',
    anchorCap: 'c-contract',
    headlineLead: L('Terms with Marcus are set: 15% of revenue with a cliff', 'Условия с Маркусом определены: 15% выручки с клиффом'),
    anchorText: L(
      'The main decision of the week was the terms for Marcus: fifteen percent of revenue, twelve months, a three-month cliff and a lawyer’s contract. It is the answer to his request for twenty percent after the missed date.',
      'Главным решением недели стали условия для Маркуса: пятнадцать процентов выручки, двенадцать месяцев, клифф три месяца и договор через юриста. Это ответ на его просьбу о двадцати процентах после сорванного срока.',
    ),
    questions: L(
      [
        'Marcus asked for 20% and you answered “15% with a cliff”. How will you know in three months that it was right?',
        'What gave you energy this week, and what took it away?',
        'Which unpleasant task did you put off the longest, and what keeps you from doing it first?',
      ],
      [
        'Маркус просил 20%, а ты ответил «15% с клиффом». Как ты поймёшь через три месяца, что это было верное решение?',
        'Что в эту неделю давало тебе энергию, а что её забирало?',
        'Какое неприятное дело ты откладывал дольше всего и что мешает сделать его первым?',
      ],
    ),
    answers: [
      {
        question: 0,
        title: L('Review answer: the decision about Marcus', 'Ответ на вопрос обзора: решение про Маркуса'),
        text: L(
          'In three months I will look at three things: did Marcus ship the portal, do we hold the Friday demo, and do I feel worse after talking to him. If not, I look for another developer or a no-code tool. What matters is that the terms are in writing and the cliff protects both of us.',
          'Через три месяца посмотрю на три вещи: сдал ли Маркус портал, ходим ли мы на пятничное демо и не стало ли мне хуже от общения с ним. Если нет, ищу другого разработчика или конструктор без кода. Главное, что условия записаны, а клифф защищает нас обоих.',
        ),
      },
      {
        question: 1,
        title: L('Review answer: energy', 'Ответ на вопрос обзора: энергия'),
        text: L(
          'Energy came from real results: Ben’s first screens, the run with Theo, a full night’s sleep. It was taken away by the conversations I put off and late finishing touches. The conclusion is simple: if a conversation is unpleasant, do it first, and close the laptop on time.',
          'Энергию давали живые результаты: первые экраны Бена, пробежка с Тео, нормальный сон. Забирали разговоры, которые я откладывал, и поздние доделки. Вывод простой: если разговор неприятный, делать его первым, а ноутбук закрывать вовремя.',
        ),
      },
    ],
  },
  {
    weeksBack: 1,
    generatedBy: 'ai',
    anchorCap: 'c-conversion',
    headlineLead: L('The price held: conversion is 38%', 'Цена выдержала проверку: конверсия 38%'),
    anchorText: L(
      'The main result of the week: the price went up and so did conversion. In two weeks after the rise there were twenty-one trials and eight payments, and monthly revenue reached six hundred forty dollars. It is a strong result on a very small sample, so the second-month churn matters most.',
      'Главный итог недели: цена выросла, а конверсия тоже. За две недели после повышения было двадцать одно пробное и восемь оплат, а выручка в месяц дошла до шестисот сорока долларов. Это сильный результат на очень маленькой выборке, поэтому важнее всего отток во второй месяц.',
    ),
    questions: L(
      [
        'Conversion rose after the price increase. Which numbers will you check so as not to believe this success too early?',
        'Which single step next week will give the most: a call, a hire, a sale or sleep?',
        'What from this week do you want to repeat, and what not?',
      ],
      [
        'Конверсия выросла после повышения цены. Какие цифры ты будешь проверять, чтобы не поверить в этот успех слишком рано?',
        'Какой один шаг на следующую неделю даст больше всего: звонок, найм, продажа или сон?',
        'Что из этой недели ты хочешь повторить, а чего больше не делать?',
      ],
    ),
    answers: [
      {
        question: 0,
        title: L('Review answer: conversion', 'Ответ на вопрос обзора: конверсия'),
        text: L(
          'I will check three things: whether conversion drops over the next two weeks, whether the share of people who cancel after the first month grows, and what the people who did not buy say. Two weeks is too little to celebrate. For now I am glad, but I stay cautious.',
          'Проверять буду три вещи: не просядет ли конверсия на следующих двух неделях, не вырастет ли доля тех, кто отменяет после первого месяца, и что говорят те, кто не купил. Две недели — это мало, чтобы радоваться. Пока рад, но осторожен.',
        ),
      },
      {
        question: 1,
        title: L('Review answer: the main step', 'Ответ на вопрос обзора: главный шаг'),
        text: L(
          'The main step for next week: first write to Hana and send Priya the plan, then everything else. These two things have been hanging the longest, and I kept walking around them. The rest, including the ads, can wait a day.',
          'Главный шаг на следующую неделю: сначала написать Хане и отправить Прие план, потом всё остальное. Эти два дела висят дольше всего, и я их обходил. Остальное, включая рекламу, может подождать один день.',
        ),
      },
    ],
  },
];
