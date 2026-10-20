import { pick as L } from '../../../i18n';
import type { CaptureSpec } from '../specs';

/** The last eleven days: good news from Nina, the conversion number, the sleep talk, the strategy session. */
export const capturesD = (): CaptureSpec[] => [
  {
    key: 'c-ci-4',
    kind: 'checkin',
    at: { d: 11, t: '08:30' },
    context: 'home',
    title: L('State: slept well', 'Состояние: выспался'),
    summary: L('Eight hours of sleep, wants to build.', 'Восемь часов сна, хочется делать.'),
    text: L(`Eight hours. Clear head, I want to build something today.`, `Восемь часов. Ясная голова, хочется сегодня что-то делать.`),
    tags: L(['state', 'sleep'], ['состояние', 'сон']),
  },
  {
    key: 'c-nina-review',
    kind: 'voice',
    at: { d: 9, t: '19:30' },
    context: 'walk',
    title: L('Nina loves the identity', 'Нине понравился фирменный стиль'),
    summary: L(
      'Nina approved the identity at the first review and mentioned a retainer. Ben’s updates helped. I promised to introduce her to two freelancers who use Lumen.',
      'Нина утвердила стиль с первого просмотра и упомянула ретейнер. Отчёты Бена помогли. Я пообещал познакомить её с двумя фрилансерами, которые пользуются Lumen.',
    ),
    text: L(
      `Nina approved the identity at the first review, no rounds of changes. She wrote that the written updates made her feel in control. That is exactly what I promised in the first call. She mentioned a retainer, a few hours every month. I predicted a good review, ninety percent, and that was right. Ben's updates were part of the reason, so I will tell him. Nina also asked whether I know freelancers who need a portal, and I said yes, two of them use Lumen, so I will introduce her to Omar. Happy day. Writing it down so I remember that things sometimes just work.`,
      `Нина утвердила стиль с первого просмотра, без кругов правок. Написала, что письменные отчёты дали ей ощущение контроля. Именно это я обещал на первом созвоне. Она упомянула ретейнер, несколько часов в месяц. Я предсказывал хороший отзыв, девяносто процентов, и это сбылось. Отчёты Бена были частью причины, так что скажу ему об этом. Нина также спросила, знаю ли я фрилансеров, которым нужен портал, и я ответил, что да, двое из них пользуются Lumen, так что познакомлю её с Омаром. Счастливый день. Записываю, чтобы помнить: иногда всё просто работает.`,
    ),
    people: ['nina', 'omar', 'ben'],
    projects: ['studio', 'team'],
    tags: L(['studio', 'client', 'win'], ['студия', 'клиент', 'успех']),
    pinned: true,
  },
  {
    key: 'c-ai-onboarding',
    kind: 'ai_chat',
    at: { d: 8, t: '22:15' },
    context: 'home',
    title: L('Chat with ChatGPT: onboarding emails', 'Чат с ChatGPT: письма при знакомстве с продуктом'),
    summary: L(
      'Drafted a three-email onboarding series for new Lumen users and a template that Omar can reuse.',
      'Набросал серию из трёх приветственных писем для новых пользователей Lumen и шаблон, который сможет использовать Омар.',
    ),
    text: L(
      `Me: I need a three-email onboarding sequence for new Lumen users. What should each email do?

ChatGPT: Email one, on day zero: welcome, one action, create your first invoice. Email two, on day three: show one feature they probably have not found, like automatic reminders. Email three, on day ten: ask what is missing and remind them the trial ends soon. Keep each under 100 words.

Me: Write the first one.

ChatGPT: "Welcome to Lumen. Create your first invoice in two minutes: lumen.example/start. If you get stuck, reply to this email, I read every message." Signed with your name.

Me: Good. I will build the sequence this weekend and a short template Omar can use with his own clients.`,
      `Я: Мне нужна серия из трёх приветственных писем для новых пользователей Lumen. Что должно делать каждое?

ChatGPT: Письмо первое, в нулевой день: приветствие и одно действие — создать первый счёт. Письмо второе, на третий день: показать одну функцию, которую они, вероятно, не нашли, например автоматические напоминания. Письмо третье, на десятый день: спросить, чего не хватает, и напомнить, что пробный период скоро закончится. Каждое не длиннее 100 слов.

Я: Напиши первое.

ChatGPT: «Добро пожаловать в Lumen. Создайте первый счёт за две минуты: lumen.example/start. Если что-то не получится, ответьте на это письмо, я читаю каждое сообщение». Подпись с вашим именем.

Я: Хорошо. Соберу серию в эти выходные и короткий шаблон, которым Омар сможет пользоваться со своими клиентами.`,
    ),
    people: ['omar'],
    projects: ['app'],
    tags: L(['onboarding', 'email', 'AI chat'], ['онбординг', 'письма', 'ИИ-чат']),
    source: { app: 'ChatGPT', importedFrom: 'chatgpt' },
  },
  {
    key: 'c-conversion',
    kind: 'voice',
    at: { d: 7, t: '18:40' },
    context: 'walk',
    title: L('The new price holds: conversion 38%', 'Новая цена держится: конверсия 38%'),
    summary: L(
      'Two weeks after the price change: 21 trials, 8 paid, conversion 38%, monthly revenue $640. Priya says two weeks is too early to celebrate.',
      'Через две недели после смены цены: 21 пробный период, 8 платных, конверсия 38%, выручка в месяц $640. Прия говорит, что рано радоваться.',
    ),
    text: L(
      `Two weeks after the price change. Twenty-one trials, eight of them became paying users. That is thirty-eight percent conversion, up from thirty-three, so the higher price did not scare anyone. Monthly recurring revenue is now six hundred forty dollars. I called Priya and she warned me that two weeks is a small sample, and that I should look at churn in month two. Fair. Another good sign: five reviews on the product page, up from three. Ben said the studio side is calmer too. Mom called and wants a Sunday visit, I need to plan that. Webinar idea: show how I use Lumen with real clients, once the portal is out. Task: look at the funnel again on Friday and write down the numbers.`,
      `Две недели после смены цены. Двадцать один пробный период, восемь стали платящими. Это тридцать восемь процентов конверсии, было тридцать три, так что высокая цена никого не испугала. Ежемесячная выручка теперь шестьсот сорок долларов. Я позвонил Прие, и она предупредила, что две недели — маленькая выборка и надо смотреть на отток во второй месяц. Справедливо. Ещё хороший знак: пять отзывов на странице продукта, было три. Бен сказал, что и со студийной стороны стало спокойнее. Мама звонила и хочет, чтобы я приехал в воскресенье, надо это запланировать. Идея вебинара: показать, как я использую Lumen с реальными клиентами, когда выйдет портал. Задача: в пятницу ещё раз посмотреть воронку и записать цифры.`,
    ),
    people: ['priya', 'ben', 'mom'],
    projects: ['app', 'news'],
    tags: L(['conversion', 'pricing', 'MRR'], ['конверсия', 'цена', 'MRR']),
    pinned: true,
  },
  {
    key: 'c-annual',
    kind: 'text',
    dictated: true,
    at: { d: 6, t: '20:20' },
    context: 'home',
    title: L('Annual plan with two months free', 'Годовой тариф с двумя бесплатными месяцами'),
    summary: L(
      'Decided to offer an annual plan: pay for ten months, get twelve. It helps cash flow. Sent Ben the pricing page to update.',
      'Решил предложить годовой тариф: платишь за десять месяцев, получаешь двенадцать. Это помогает денежному потоку. Отправил Бену страницу цен на обновление.',
    ),
    text: L(
      `Decided: an annual plan, pay for ten months and get twelve. It brings cash in earlier and customers who pay yearly rarely leave. I wrote the new pricing text and sent it to Ben to update the page. Open question: what if people who are on monthly switch and the monthly revenue drops? I think it is worth it. I wrote the message to the existing users already.`,
      `Решил: годовой тариф, платишь за десять месяцев, получаешь двенадцать. Деньги приходят раньше, а клиенты, которые платят за год, редко уходят. Я написал новый текст цен и отправил Бену обновить страницу. Открытый вопрос: что, если те, кто платит ежемесячно, перейдут и ежемесячная выручка упадёт? Думаю, оно того стоит. Сообщение для существующих пользователей я уже написал.`,
    ),
    people: ['ben'],
    projects: ['app'],
    tags: L(['pricing', 'cash'], ['цена', 'деньги']),
  },
  {
    key: 'c-mom-sleep',
    kind: 'voice',
    at: { d: 5, t: '21:40' },
    context: 'home',
    title: L('Mom and the sleep conversation', 'Разговор с мамой о сне'),
    summary: L(
      'Mom noticed I sleep little. I decided to stop coding after 11 pm and promised her I will answer her call on Sunday.',
      'Мама заметила, что я мало сплю. Я решил не писать код после 23:00 и пообещал ответить на её воскресный звонок.',
    ),
    text: L(
      `Mom called and said, straight away, that I sound tired. She is right. Five and a half hours of sleep three nights in a row, and every time I tell myself it is the last time. Decision: no coding after eleven at night, the laptop goes in the other room. I will check in two weeks how that works. I predict I keep the rule at least ten days out of fourteen, fifty-five percent. I promised Mom to pick up the phone on Sunday, no excuses, and not to read messages while she talks. Also Coach Dana said sleep is part of the plan, and now Mom and Dana agree, which is a bit embarrassing. Writing this down: late work makes the next day worse and the next night even shorter.`,
      `Мама позвонила и сразу сказала, что я звучу уставшим. Она права. Пять с половиной часов сна три ночи подряд, и каждый раз я говорю себе, что это в последний раз. Решение: после одиннадцати вечера никакого кода, ноутбук уходит в другую комнату. Через две недели проверю, как это работает. Прогнозирую, что соблюдаю правило минимум десять дней из четырнадцати, пятьдесят пять процентов. Я пообещал маме снять трубку в воскресенье, без отговорок, и не читать сообщения, пока она говорит. А ещё тренер Дана говорила, что сон — часть плана, и теперь мама и Дана согласны друг с другом, что немного неловко. Записываю: поздняя работа делает следующий день хуже, а следующую ночь ещё короче.`,
    ),
    people: ['mom'],
    projects: ['run'],
    tags: L(['sleep', 'family', 'decision'], ['сон', 'семья', 'решение']),
  },
  {
    key: 'c-strategy',
    kind: 'voice',
    at: { d: 4, t: '17:50' },
    context: 'walk',
    title: L('Eight-week plan: $1,000 MRR', 'План на восемь недель: $1 000 MRR'),
    summary: L(
      'Walked and thought through the next eight weeks: reach $1,000 MRR, launch referrals and a lead magnet, delegate more, stop two side projects.',
      'Гулял и продумал следующие восемь недель: выйти на $1 000 MRR, запустить рефералы и лид-магнит, больше делегировать, закрыть два побочных проекта.',
    ),
    text: L(
      `Long walk, long thought. The next eight weeks, written as clearly as I can. The goal: one thousand dollars of monthly recurring revenue. Today it is about six hundred fifty, so I need roughly thirty new paying users. I put the chance of reaching one thousand by the end of the quarter at thirty percent, honestly, because it depends on the portal shipping and on one channel working. Three moves. One: a lead magnet for the newsletter, a short guide to getting paid on time, so each subscriber has a reason to try Lumen. Two: a simple referral idea, one free month for both sides. Three: stop things that do not feed the goal. I am dropping two side experiments and a plugin idea. Ben takes more of the studio work and Nina's retainer, Marcus keeps the portal, and I focus on the newsletter and onboarding. Priya will like this. Marcus needs to ship the demo, Nina's invoice goes out, and I should schedule a call with Sam, Theo and Ben on Saturday: no, only the run with Theo. Remove from the list: the plugin and the extra landing page. Tomorrow morning I write the guide. A year from now I want to look back and say: this was the week I became a founder instead of a freelancer with a side project.`,
      `Долгая прогулка, долгие мысли. Следующие восемь недель, записываю как можно яснее. Цель: тысяча долларов ежемесячной выручки. Сегодня около шестисот пятидесяти, значит нужно примерно тридцать новых платящих пользователей. Шанс выйти на тысячу к концу квартала оцениваю в тридцать процентов, честно, потому что всё зависит от выхода портала и от того, заработает ли один канал. Три хода. Первый: лид-магнит для рассылки, короткий гайд о том, как получать оплату вовремя, чтобы у каждого подписчика была причина попробовать Lumen. Второй: простая реферальная идея, бесплатный месяц обоим. Третий: остановить то, что не работает на цель. Отказываюсь от двух побочных экспериментов и идеи с плагином. Бен берёт больше студийной работы и ретейнер Нины, Маркус ведёт портал, а я занимаюсь рассылкой и онбордингом. Прие это понравится. Маркусу нужно показать демо, счёт Нине уйдёт, и мне надо назначить звонок с Сэм, Тео и Беном в субботу: нет, только пробежка с Тео. Убрать из списка: плагин и дополнительный лендинг. Завтра утром пишу гайд. Через год хочу оглянуться и сказать: вот на этой неделе я стал основателем, а не фрилансером с побочным проектом.`,
    ),
    people: ['priya', 'marcus', 'nina', 'ben', 'sam', 'theo'],
    projects: ['app', 'news', 'team'],
    tags: L(['strategy', 'MRR', 'focus'], ['стратегия', 'MRR', 'фокус']),
    pinned: true,
  },
  {
    key: 'c-ci-5',
    kind: 'checkin',
    at: { d: 3, t: '09:20' },
    context: 'home',
    title: L('State: broke my promise', 'Состояние: нарушил обещание'),
    summary: L('Five hours of sleep, broke the promise to Mom.', 'Спал пять часов, нарушил обещание маме.'),
    text: L(
      `Five hours. I broke the promise to Mom: I coded until one at night anyway. Feeling guilty and tired.`,
      `Пять часов. Нарушил обещание маме: всё равно просидел за кодом до часу ночи. Чувствую вину и усталость.`,
    ),
    people: ['mom', 'priya'],
    projects: ['run'],
    tags: L(['state', 'sleep', 'family'], ['состояние', 'сон', 'семья']),
  },
  {
    key: 'c-mentor-3',
    kind: 'voice',
    at: { d: 3, t: '20:30' },
    context: 'walk',
    title: L('Priya: metrics homework', 'Прия: домашнее задание по метрикам'),
    summary: L(
      'Priya looked at CAC $62 and LTV $84 and said it is workable but fragile. I promised her an updated plan in a week.',
      'Прия посмотрела на CAC $62 и LTV $84 и сказала, что это работоспособно, но хрупко. Я пообещал обновлённый план через неделю.',
    ),
    text: L(
      `Third talk with Priya. She looked at the numbers I sent: CAC is about sixty-two dollars, LTV about eighty-four. Workable, but fragile, she says, one bad month and it flips. The first number came from my rough guess of how long people stay, the average customer stays seven months. She asked about Ben and the studio, and I said it is going well. She wants an updated eight-week plan in a week and she asked me to think about whether I want an assistant in the studio or in the product. I asked whether an admin from her network could help, and she said maybe, twenty-five percent chance, she needs to ask. Next call in two weeks.`,
      `Третий разговор с Прией. Она посмотрела цифры, которые я прислал: CAC около шестидесяти двух долларов, LTV около восьмидесяти четырёх. Работоспособно, но хрупко, говорит она, один плохой месяц, и всё переворачивается. Первая цифра взята из моей грубой оценки срока жизни клиента, в среднем семь месяцев. Она спросила про Бена и студию, я сказал, что идёт хорошо. Она хочет обновлённый план на восемь недель через неделю и попросила подумать, нужен ли мне помощник в студии или в продукте. Я спросил, может ли помочь администратор из её сети, и она сказала, что, может быть, шанс двадцать пять процентов, надо уточнить. Следующий созвон через две недели.`,
    ),
    people: ['priya', 'ben'],
    projects: ['app', 'news', 'team'],
    tags: L(['mentor', 'CAC', 'LTV'], ['ментор', 'CAC', 'LTV']),
  },
  {
    key: 'c-sam-session',
    kind: 'voice',
    at: { d: 2, t: '14:00' },
    context: 'transit',
    title: L('Mentoring session with Sam', 'Занятие с Сэм'),
    summary: L(
      'Sam showed her portfolio, I gave honest feedback. She asked if Omar could be a reference. I decided to write her a short recommendation.',
      'Сэм показала портфолио, я дал честную обратную связь. Она спросила, может ли Омар стать рекомендацией. Решил написать ей короткую рекомендацию.',
    ),
    text: L(
      `Weekend session with Sam on the train. She showed her portfolio, the work is good, the order is wrong: the best project is third. I told her honestly. She asked whether I know someone who could vouch for her, and I thought of Omar. Probability he agrees to be a reference: sixty-five percent. Decided: I write her a short recommendation myself, and she sends it with every application. A question I need to answer: should I teach more, or is it a distraction from Lumen? Ben also came up, and I should give him feedback by Thursday.`,
      `Занятие с Сэм по выходным, в электричке. Она показала портфолио, работы хорошие, порядок неправильный: лучший проект третий. Я сказал ей честно. Она спросила, знаю ли я, кто мог бы за неё поручиться, и я подумал об Омаре. Вероятность, что он согласится дать рекомендацию, — шестьдесят пять процентов. Решил: я сам напишу ей короткую рекомендацию, и она будет отправлять её с каждой заявкой. Вопрос, на который нужно ответить: стоит ли больше учить других или это отвлекает от Lumen? Ещё всплыл Бен, и мне надо дать ему отзыв до четверга.`,
    ),
    people: ['sam', 'omar', 'ben'],
    projects: ['team'],
    tags: L(['mentoring', 'portfolio'], ['менторство', 'портфолио']),
  },
  {
    key: 'c-tasks',
    kind: 'text',
    dictated: true,
    at: { d: 2, t: '22:30' },
    context: 'home',
    title: L('Task list for tomorrow', 'Список дел на завтра'),
    summary: L(
      'A list for tomorrow: send the invoice to Nina, remind Marcus about the demo, call Greg, tell Maya the dinner plan.',
      'Список на завтра: отправить счёт Нине, напомнить Маркусу про демо, позвонить Грегу, сообщить Майе план ужина.',
    ),
    text: L(
      `Tomorrow, in order. One: send the invoice to Nina first thing in the morning. Two: remind Marcus about the Friday demo, in writing. Three: call Greg about the payment, he promised it yesterday. Four: tell Maya about the dinner on Saturday. Five: post the newsletter issue as a voice note for the webinar. Six: check the funnel numbers. Prediction: Greg pays this week, forty-five percent.`,
      `Завтра по порядку. Раз: первым делом утром отправить счёт Нине. Два: письменно напомнить Маркусу о пятничном демо. Три: позвонить Грегу насчёт оплаты, он вчера обещал. Четыре: сказать Майе про ужин в субботу. Пять: записать выпуск рассылки голосовой заметкой для вебинара. Шесть: проверить цифры воронки. Прогноз: Грег оплатит на этой неделе, сорок пять процентов.`,
    ),
    people: ['nina', 'marcus', 'omar', 'greg', 'maya'],
    projects: ['news', 'studio', 'app'],
    tags: L(['tasks', 'plan'], ['задачи', 'план']),
  },
  {
    key: 'c-marcus-demo',
    kind: 'voice',
    at: { d: 1, t: '18:20' },
    context: 'walk',
    title: L('Friday demo with Marcus', 'Пятничное демо с Маркусом'),
    summary: L(
      'The demo shows the portal login and the invoice list, but not the logo. Marcus needs nine more days. 14 users are on the team plan.',
      'Демо показывает вход в портал и список счетов, но не логотип. Маркусу нужно ещё девять дней. На командном тарифе 14 пользователей.',
    ),
    text: L(
      `The Friday demo happened. Marcus showed the login and the invoice list in the portal. The logo part is not ready, and the recurring invoices are not either. He needs nine more days. This time the delay was visible after a week, as planned, and I was calm instead of angry. Fourteen people use the team plan already. I think the chance that he ships the logo version within nine days is thirty-five percent, to be honest. I promised him to send the logo specs tomorrow. Ben saw the demo as well and had two good ideas for the layout.`,
      `Пятничное демо состоялось. Маркус показал вход и список счетов в портале. Часть с логотипом не готова, регулярные счета тоже. Ему нужно ещё девять дней. На этот раз задержка стала видна через неделю, как и планировалось, и я был спокоен, а не зол. Командным тарифом уже пользуются четырнадцать человек. Думаю, шанс, что он выпустит версию с логотипом за девять дней, тридцать пять процентов, если честно. Я пообещал прислать ему требования к логотипу завтра. Бен тоже видел демо и предложил две хорошие идеи по макету.`,
    ),
    people: ['marcus', 'ben', 'sam'],
    projects: ['app'],
    tags: L(['portal', 'demo', 'partner'], ['портал', 'демо', 'партнёр']),
  },
  {
    key: 'c-evening-idea',
    kind: 'voice',
    at: { d: 1, t: '21:45' },
    context: 'home',
    title: L('An evening idea about follow-ups', 'Вечерняя идея про напоминания'),
    summary: L(
      'Thoughts after the day: I should send Greg a gentle reminder, ask Hana one question and block evenings for Maya.',
      'Мысли после дня: надо мягко напомнить Грегу, задать Хане один вопрос и оставить вечера для Майи.',
    ),
    text: L(
      `Evening. A few thoughts before sleep. First, Greg: send him a gentle reminder tomorrow, with the date, not a complaint. I will probably renew the studio work with Greg, sixty percent. Second, Hana from the agency: one single question, "do you want a demo of the portal when it is ready?" Third, Maya and I agreed on Wednesdays without laptops. An idea: ten-minute evening walks after dinner, a habit I could start tomorrow. Nina's invoice already went out. Mom would approve.`,
      `Вечер. Несколько мыслей перед сном. Первое, Грег: завтра отправлю ему мягкое напоминание с датой, а не претензию. Скорее всего продлю студийную работу с Грегом, шестьдесят процентов. Второе, Хана из агентства: один единственный вопрос — «хотите демо портала, когда он будет готов?» Третье, мы с Майей договорились о средах без ноутбуков. Идея: десятиминутные вечерние прогулки после ужина, привычка, которую можно начать завтра. Счёт Нине уже отправлен. Мама бы одобрила.`,
    ),
    people: ['greg', 'hana', 'nina', 'maya', 'mom'],
    projects: ['studio', 'app'],
    tags: L(['evening', 'follow-up', 'habits'], ['вечер', 'follow-up', 'привычки']),
    status: 'review',
  },
  {
    key: 'c-today-walk',
    kind: 'voice',
    at: { ago: 190 },
    context: 'walk',
    title: L('A walk: fifty subscribers more', 'Прогулка: ещё пятьдесят подписчиков'),
    summary: L(
      'The newsletter has 640 subscribers. Priya’s intro came through, Marcus is on schedule, and I should write the retainer proposal for Nina.',
      'В рассылке 640 подписчиков. Знакомство от Прии состоялось, Маркус идёт по графику, а Нине надо написать предложение по ретейнеру.',
    ),
    text: L(
      `Walking, short thoughts. The newsletter reached six hundred forty subscribers, and fourteen people are on the team plan, mood is good. Priya's intro came through: the founder wrote to me and offered a call. Marcus is on schedule, so far. I need to write the retainer proposal for Nina this week. Reminder to ask Priya about the assistant again. It is a good day, no panic. Post for the review: the guide is done.`,
      `Гуляю, короткие мысли. В рассылке дошли до шестисот сорока подписчиков, четырнадцать человек на командном тарифе, настроение хорошее. Знакомство от Прии состоялось: основатель написал мне и предложил созвон. Маркус пока идёт по графику. Мне нужно на этой неделе написать Нине предложение по ретейнеру. Напоминание: снова спросить Прию про помощника. Хороший день, без паники. Пост для обзора: гайд готов.`,
    ),
    people: ['priya', 'marcus', 'ben', 'nina'],
    projects: ['news', 'app', 'studio'],
    tags: L(['newsletter', 'plan'], ['рассылка', 'план']),
    status: 'review',
  },
  {
    key: 'c-today-quick',
    kind: 'voice',
    at: { ago: 95 },
    context: 'other',
    title: L('A quick thought', 'Быстрая мысль'),
    summary: L('A thought about a changelog page.', 'Мысль о странице с историей изменений.'),
    text: L(
      `Quick thought: a changelog page for Lumen, so users see I ship every week.`,
      `Быстрая мысль: страница с историей изменений для Lumen, чтобы пользователи видели, что я выпускаю обновления каждую неделю.`,
    ),
    projects: ['app'],
    tags: L(['idea'], ['идея']),
    status: 'transcribed',
  },
  {
    key: 'c-ci-6',
    kind: 'checkin',
    at: { ago: 40 },
    context: 'home',
    title: L('State: fine, a bit tense', 'Состояние: нормально, немного напряжён'),
    summary: L('Six and a half hours of sleep, worried about Hana.', 'Спал шесть с половиной часов, думаю о Хане.'),
    text: L(
      `Six and a half hours. Good mood, a bit tense because of Hana's silence.`,
      `Шесть с половиной часов. Настроение хорошее, немного напряжён из-за молчания Ханы.`,
    ),
    people: ['hana'],
    tags: L(['state', 'sleep'], ['состояние', 'сон']),
  },
];
