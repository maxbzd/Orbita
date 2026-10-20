import { pick as L } from '../../../i18n';
import type { CaptureSpec } from '../specs';

/** The first three weeks (days 59–40 ago): where Lumen stands, the developer, the mentor. */
export const capturesA = (): CaptureSpec[] => [
  {
    key: 'c-start',
    kind: 'voice',
    at: { d: 59, t: '19:10' },
    context: 'walk',
    title: L('Where Lumen stands', 'Где сейчас Lumen'),
    summary: L(
      'Twenty-seven paying users at $9, about $243 a month, savings for nine months. Plan: reach fifty paying users and start a newsletter.',
      'Двадцать семь платящих пользователей по $9, около $243 в месяц, сбережений хватит на девять месяцев. План: дойти до пятидесяти платящих и запустить рассылку.',
    ),
    text: L(
      `Okay, entry number one, I guess. Walking around the block, it is getting cold. So, where am I. Lumen has twenty-seven paying users now, nine dollars a month each, which is about two hundred forty-three dollars of monthly recurring revenue. Not a business yet, but it is not zero either, and nobody has asked for a refund. I left the agency seven months ago and my savings cover about nine more months if I keep studio work going. Studio work pays the rent, Lumen is the bet. The goal for this month is fifty paying users. I do not know if nine dollars is right, everyone tells me something different. Theo said it is too cheap, my gut says too cheap as well, but I have nothing to base it on. I also want to start a newsletter about building small products, because I keep explaining the same things to people anyway. And I owe Theo a reply about running on Saturday, I forgot again.`,
      `Так, запись номер один, наверное. Хожу вокруг дома, уже холодно. Где я сейчас. У Lumen двадцать семь платящих пользователей, по девять долларов в месяц, это около двухсот сорока трёх долларов ежемесячной выручки. Это ещё не бизнес, но и не ноль, и никто не просил вернуть деньги. Я ушёл из агентства семь месяцев назад, и сбережений хватит ещё примерно на девять месяцев, если продолжу студийные заказы. Студия оплачивает аренду, Lumen — это ставка. Цель на месяц — пятьдесят платящих пользователей. Не знаю, верна ли цена в девять долларов, все говорят разное. Тео сказал, что слишком дёшево, моя интуиция тоже, но опереться мне не на что. Ещё хочу запустить рассылку о том, как делать небольшие продукты, потому что я всё равно постоянно объясняю одно и то же. И должен ответить Тео про субботнюю пробежку, опять забыл.`,
    ),
    people: ['theo'],
    projects: ['app', 'news'],
    tags: L(['pricing', 'plans', 'MRR'], ['цена', 'планы', 'MRR']),
  },
  {
    key: 'c-plan-focus',
    kind: 'text',
    dictated: true,
    at: { d: 57, t: '20:30' },
    context: 'home',
    title: L('One channel, not three', 'Один канал вместо трёх'),
    summary: L(
      'Decided to put the next two months into the newsletter and skip paid ads. Studio work is capped at three days a week.',
      'Решил вложить ближайшие два месяца в рассылку и не тратиться на рекламу. Студийная работа — не больше трёх дней в неделю.',
    ),
    text: L(
      `I need to choose how to get users. There are three options: paid ads, cold outreach to freelancers, or a newsletter that brings people in on its own. Ads cost money I would rather keep, outreach feels like a full-time job, and the newsletter compounds slowly but it is mine. Decided: for the next two months the newsletter is the only acquisition channel, and I will not run paid ads until the numbers show a clear return. Reasons: it fits how I like to work, it builds trust, and it costs only my time. I expect around three hundred subscribers and five new paying users from it by the end of the second month. Review the decision in four weeks. One more rule: studio work gets three days a week at most, otherwise Lumen never moves. Three days means saying no to one project this month, and that is fine.`,
      `Надо выбрать, как привлекать пользователей. Вариантов три: платная реклама, холодные письма фрилансерам или рассылка, которая приводит людей сама. Реклама стоит денег, которые я хочу сохранить, письма похожи на отдельную работу, а рассылка копится медленно, зато она моя. Решил: ближайшие два месяца рассылка — единственный канал привлечения, а платную рекламу не запускаю, пока цифры не покажут явную отдачу. Причины: так мне комфортнее работать, это строит доверие и стоит только моего времени. Ожидаю около трёхсот подписчиков и пятерых новых платящих пользователей к концу второго месяца. Вернуться к решению через четыре недели. И ещё правило: студийным заказам не больше трёх дней в неделю, иначе Lumen не сдвинется. Три дня значит отказаться от одного проекта в этом месяце, и это нормально.`,
    ),
    projects: ['app', 'news'],
    tags: L(['channels', 'plans'], ['каналы', 'планы']),
  },
  {
    key: 'c-nina-first',
    kind: 'voice',
    at: { d: 55, t: '18:40' },
    context: 'walk',
    title: L('Kickoff call with Nina', 'Первый созвон с Ниной'),
    summary: L(
      'Nina Brandt wants a new identity for her agency. I promised a proposal by Monday and a short written update after each milestone.',
      'Нина Бранд хочет новый фирменный стиль для агентства. Я пообещал предложение к понедельнику и короткий отчёт после каждого этапа.',
    ),
    text: L(
      `Okay, the call with Nina is done. I walked out soaked, honestly. Forty minutes instead of an hour because I wanted to cover everything and ended up explaining instead of asking. Next time it is the other way around. Nina runs a small brand agency and wants a new identity for it, logo, colors, a simple site. She is exactly the kind of client I want: clear, pays fast, and respects the process. After the call she asked how I will keep her informed. I promised to send a proposal on Monday and a short written update after every milestone, what is done, what is next, what I need from her. She said that is what she needs. She also hinted at a monthly retainer if this goes well. I think she will sign, maybe ninety percent. I need to figure out how to send invoices that do not look like a spreadsheet, which is a bit ironic given what I am building.`,
      `Ну всё, созвон с Ниной закончился. Вышел весь мокрый, честно. Сорок минут вместо часа, потому что хотел охватить всё и в итоге объяснял, а не спрашивал. В следующий раз наоборот. Нина руководит небольшим брендинговым агентством и хочет новый фирменный стиль: логотип, цвета, простой сайт. Это именно тот клиент, которого я хочу: чёткий, платит быстро и уважает процесс. После созвона она спросила, как я буду держать её в курсе. Я пообещал прислать предложение в понедельник и после каждого этапа короткий отчёт: что сделано, что дальше, что нужно от неё. Она сказала, что это то, что ей нужно. Ещё намекнула на ежемесячный ретейнер, если всё пойдёт хорошо. Думаю, подпишет, процентов на девяносто. Надо придумать, как отправлять счета, которые не похожи на таблицу, что довольно иронично, учитывая, что я делаю.`,
    ),
    people: ['nina'],
    projects: ['studio'],
    tags: L(['studio', 'client', 'proposal'], ['студия', 'клиент', 'предложение']),
  },
  {
    key: 'c-marcus-deal',
    kind: 'voice',
    at: { d: 52, t: '21:15' },
    context: 'walk',
    title: L('Marcus and Lumen: equity or revenue share', 'Маркус и Lumen: доля или процент с выручки'),
    summary: L(
      'Two hours with Marcus about the client portal v2. He wants 25% equity, I offered a 15% revenue share and a first version in a month.',
      'Два часа с Маркусом про клиентский портал v2. Он хочет 25% доли, я предложил 15% с выручки и первую версию через месяц.',
    ),
    text: L(
      `Okay. I need to say this out loud before I forget. Today I spent two hours on a call with Marcus. Marcus is a developer, he has a day job, and we have known each other for years. I told him about the idea of a client portal version two. The idea is simple: a freelancer sends one link and the client sees the invoices, the files and the status of the project in one place, with the freelancer's own logo. Marcus said he can build a first version in a month, evenings only. Then he talked about money. He wants twenty-five percent of the company. Twenty-five! I almost laughed. I said: you write the code, I do the product, the customers, the design and the whole business, and Lumen already has paying users. We settled for now on a preliminary fifteen percent revenue share for twelve months, not equity, and a first version by the end of the month. He said he will think and write back. Honestly I do not know if this is right. Without him I cannot build the portal myself, I code a bit, but not at that level. On the other hand, a share of a thing that does not exist is just words. Fine. I will ask around how people usually split this, and we need to put it on paper so nobody remembers it differently. I also promised to send him a one-page spec of what the portal should do by the weekend. And I think the chance he ships on time is around eighty-five percent. He seems responsible. Although, um, we will see.`,
      `Так. Это надо проговорить, пока не забыл. Сегодня два часа сидел на звонке с Маркусом. Маркус — разработчик, у него основная работа, и мы знакомы много лет. Я рассказал ему про идею клиентского портала версии два. Идея простая: фрилансер отправляет одну ссылку, и клиент видит счета, файлы и статус проекта в одном месте, с логотипом фрилансера. Маркус сказал, что соберёт первую версию за месяц, только вечерами. А потом он заговорил про деньги. Хочет двадцать пять процентов компании. Двадцать пять! Я чуть не засмеялся. Я говорю: ты пишешь код, я делаю продукт, клиентов, дизайн и весь бизнес, а у Lumen уже есть платящие пользователи. Договорились пока на предварительные пятнадцать процентов с выручки на двенадцать месяцев, не долю в компании, и на первую версию к концу месяца. Он сказал, что подумает и напишет. Честно, я не знаю, правильно ли это. Без него я портал сам не сделаю, я немного пишу код, но не на таком уровне. С другой стороны, доля в том, чего ещё нет, — это просто слова. Ладно. Я поспрашиваю, как обычно такое делят, и надо оформить это на бумаге, чтобы никто не запомнил по-своему. Ещё пообещал прислать ему страницу с описанием того, что должен уметь портал, к выходным. И думаю, что вероятность, что он сдаст вовремя, процентов восемьдесят пять. Он вроде ответственный. Хотя, э-э, посмотрим.`,
    ),
    people: ['marcus'],
    projects: ['app'],
    tags: L(['partner', 'revenue share', 'portal'], ['партнёр', 'доля', 'портал']),
    pinned: true,
  },
  {
    key: 'c-ai-equity',
    kind: 'ai_chat',
    at: { d: 50, t: '22:05' },
    context: 'home',
    title: L('Chat with Claude: how to split with a developer', 'Чат с Claude: как делиться с разработчиком'),
    summary: L(
      'Learned how vesting and a cliff work and decided to put the revenue share into a written agreement checked by a lawyer.',
      'Разобрался, как работают вестинг и клифф, и решил оформить долю с выручки письменным договором, который проверит юрист.',
    ),
    text: L(
      `Me: I run a small SaaS alone. A part-time developer wants 25% of the company, I want to offer a 15% revenue share. How is this usually split?

Claude: There is no single standard, but there is logic. A share should reflect contribution and risk, not promises. A technical co-founder who joins very early often gets 10–25% of equity, but if the product already has users and revenue, a revenue share or a smaller equity stake with vesting is common. Three things matter more than the number: vesting, the term and the scope of responsibility.

Me: What is vesting?

Claude: The share is earned gradually. A classic scheme is four years with a one-year cliff, then monthly. If someone leaves after three months, they do not walk away with equity. For your size you can simplify: twelve months, three-month cliff.

Me: Can I just agree on this in a chat?

Claude: You can, but a short written agreement is much safer. This is not legal advice: have a lawyer look at a simple contract.

Me: Okay. Then I offer Marcus fifteen percent of revenue for twelve months with a three-month cliff, in a contract reviewed by a lawyer.

Claude: Sounds reasonable. Write the terms in one paragraph, present them as a proposal rather than an ultimatum, and ask what is critical for him.`,
      `Я: Я один веду небольшой SaaS. Разработчик на частичной занятости хочет 25% компании, я хочу предложить 15% с выручки. Как такое обычно делят?

Claude: Единого стандарта нет, но есть логика. Доля должна отражать вклад и риск, а не обещания. Технический сооснователь на самом старте часто получает 10–25% долей, но если у продукта уже есть пользователи и выручка, обычно используют процент с выручки или небольшую долю с вестингом. Три вещи важнее самой цифры: вестинг, срок и зона ответственности.

Я: Что такое вестинг?

Claude: Доля заслуживается постепенно. Классическая схема: четыре года с годовым клиффом, потом помесячно. Если человек уходит через три месяца, он не забирает долю с собой. Для вашего масштаба можно упростить: двенадцать месяцев, клифф три месяца.

Я: Можно просто договориться в чате?

Claude: Можно, но короткий письменный договор намного надёжнее. Это не юридическая консультация: пусть юрист посмотрит простой договор.

Я: Хорошо. Тогда предлагаю Маркусу пятнадцать процентов выручки на двенадцать месяцев с клиффом три месяца, в договоре, который проверит юрист.

Claude: Звучит разумно. Запишите условия одним абзацем, подайте как предложение, а не ультиматум, и спросите, что для него критично.`,
    ),
    people: ['marcus'],
    projects: ['app'],
    tags: L(['partner', 'revenue share', 'AI chat'], ['партнёр', 'доля', 'ИИ-чат']),
    source: { app: 'Claude', importedFrom: 'claude' },
  },
  {
    key: 'c-ci-1',
    kind: 'checkin',
    at: { d: 49, t: '08:50' },
    context: 'home',
    title: L('State: heavy head', 'Состояние: тяжёлая голова'),
    summary: L('Slept five hours, a studio deadline tomorrow.', 'Спал пять часов, завтра сдача студийного проекта.'),
    text: L(
      `Slept about five hours. Head is heavy, the studio deadline is tomorrow and I still have two screens to finish.`,
      `Спал часов пять. Голова тяжёлая, завтра сдача студийного проекта, а у меня ещё два экрана не готовы.`,
    ),
    projects: ['studio'],
    tags: L(['state', 'sleep'], ['состояние', 'сон']),
  },
  {
    key: 'c-rewrite',
    kind: 'voice',
    at: { d: 47, t: '17:20' },
    context: 'transit',
    title: L('Rewrite the app or keep shipping', 'Переписывать приложение или продолжать выпускать'),
    summary: L(
      'Marcus suggests rewriting the front end in a new framework. I decided not to: the rewrite would eat a month with no new revenue.',
      'Маркус предлагает переписать фронтенд на новом фреймворке. Я решил не делать этого: переписывание съест месяц без новой выручки.',
    ),
    text: L(
      `Riding the train, so quickly. Marcus pinged me again with the idea of rewriting the front end in a new framework. He says it will be faster and cleaner. Maybe, but I counted: a rewrite is at least a month of his evenings and zero new features for customers. Decided not to rewrite now, we keep shipping on what we have and revisit when something actually hurts. The old code is ugly but it works, and our users do not care what is inside. I think the chance that the rewrite would pay off within three months is about twenty percent. Task for me: pin the list of next features somewhere Marcus can see it, so the argument is about customers and not about taste. One more thing: should I worry that he is bored with the current stack? I do not know. Need to ask him directly.`,
      `Еду в электричке, поэтому быстро. Маркус опять написал с идеей переписать фронтенд на новом фреймворке. Говорит, будет быстрее и чище. Может быть, но я посчитал: переписывание — это минимум месяц его вечеров и ноль новых функций для пользователей. Решил не переписывать сейчас, продолжаем выпускать на том, что есть, и вернёмся, когда что-то реально начнёт мешать. Старый код некрасивый, но работает, а пользователям всё равно, что внутри. Думаю, шанс, что переписывание окупится за три месяца, процентов двадцать. Задача мне: закрепить список ближайших функций там, где его увидит Маркус, чтобы спор шёл о пользователях, а не о вкусе. И ещё: не скучно ли ему на текущем стеке? Не знаю. Надо спросить напрямую.`,
    ),
    people: ['marcus'],
    projects: ['app'],
    tags: L(['code', 'decision', 'priorities'], ['код', 'решение', 'приоритеты']),
  },
  {
    key: 'c-mentor-1',
    kind: 'voice',
    at: { d: 44, t: '19:45' },
    context: 'walk',
    title: L('First long talk with Priya', 'Первый долгий разговор с Прией'),
    summary: L(
      'Priya pushed me on numbers: churn, trial conversion and how many hours Lumen really gets. I promised her my metrics; she promised an intro to a founder.',
      'Прия прижала меня по цифрам: отток, конверсия пробного периода и сколько часов в неделю реально получает Lumen. Я пообещал прислать метрики, она — познакомить с основателем.',
    ),
    text: L(
      `Just finished the first long talk with Priya, the mentor a friend introduced me to. She sold her software company two years ago, and she is the first person who asks me questions I cannot answer. How many trials turn into paying users? I did not know. What is the monthly churn? Roughly, I said, and she raised an eyebrow. How many hours a week does Lumen really get? Maybe fifteen, maybe less. She said a business with fifteen hours of attention grows like a hobby, and hobbies are fine, but I should pick which one this is. That stung, but she is right. I promised to send her my real numbers by the end of the week: trials, conversions, churn, hours. She promised to introduce me to a founder she knows who runs a similar tool, so I do not repeat his mistakes. Good day. I have not felt this clear in a long while. Need to pay the first invoice to the lawyer for the contract draft and keep going.`,
      `Только что закончил первый долгий разговор с Прией, наставницей, с которой меня познакомил друг. Два года назад она продала свою софтверную компанию, и она первый человек, который задаёт мне вопросы, на которые я не могу ответить. Сколько пробных периодов превращается в платные? Не знал. Какой месячный отток? Примерно, говорю, и она подняла бровь. Сколько часов в неделю реально получает Lumen? Может, пятнадцать, может, меньше. Она сказала, что бизнес с пятнадцатью часами внимания растёт как хобби, и хобби — это нормально, но мне надо выбрать, что это такое. Было неприятно, но она права. Я пообещал прислать ей реальные цифры к концу недели: пробные периоды, конверсию, отток, часы. Она пообещала познакомить с основателем, который делает похожий инструмент, чтобы я не повторял его ошибок. Хороший день. Давно не чувствовал такой ясности. Надо ещё оплатить первый счёт юристу за проект договора и продолжать.`,
    ),
    people: ['priya'],
    projects: ['app', 'news'],
    tags: L(['mentor', 'metrics', 'focus'], ['ментор', 'метрики', 'фокус']),
    pinned: true,
  },
  {
    key: 'c-newsletter',
    kind: 'text',
    dictated: true,
    at: { d: 42, t: '13:10' },
    context: 'work',
    title: L('Newsletter: first issue and a name', 'Рассылка: первый выпуск и название'),
    summary: L(
      'The newsletter will be called Small Bets. First issue on Thursday, weekly after that. I expect 300 subscribers in four weeks.',
      'Рассылка будет называться Small Bets. Первый выпуск в четверг, дальше еженедельно. Жду 300 подписчиков за четыре недели.',
    ),
    text: L(
      `Decided the name: Small Bets. The first issue goes out on Thursday, then every week, same day, same time. Each issue is one story, one number and one link. Theo read the draft and said it sounds like me, which I take as praise. I set up the signup form on the Lumen page and added a short welcome message. I think we reach three hundred subscribers in four weeks, maybe fifty percent sure, because it depends on one post being shared. Task: write the issue in advance and schedule it, so a busy day does not skip an issue. The rule is simple: an issue a week, no exceptions, even a short one.`,
      `Решил название: Small Bets. Первый выпуск выходит в четверг, потом каждую неделю, в тот же день и в то же время. В каждом выпуске одна история, одна цифра и одна ссылка. Тео прочитал черновик и сказал, что это очень похоже на меня, принимаю как комплимент. Я настроил форму подписки на странице Lumen и добавил короткое приветственное письмо. Думаю, мы наберём триста подписчиков за четыре недели, уверенность около пятидесяти процентов, потому что многое зависит от одного поста, которым поделятся. Задача: писать выпуск заранее и ставить в расписание, чтобы загруженный день не срывал выпуск. Правило простое: выпуск в неделю, без исключений, пусть даже короткий.`,
    ),
    people: ['theo'],
    projects: ['news'],
    tags: L(['newsletter', 'audience'], ['рассылка', 'аудитория']),
  },
];
