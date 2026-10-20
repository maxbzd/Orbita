import { pick as L } from '../../../i18n';
import type { CaptureSpec } from '../specs';

/** Days 20–12 ago: a missed deadline, the mentor’s hard questions, a silent lead, the contract. */
export const capturesC = (): CaptureSpec[] => [
  {
    key: 'c-marcus-slip',
    kind: 'voice',
    at: { d: 20, t: '20:10' },
    context: 'walk',
    title: L('Marcus misses the portal deadline', 'Маркус срывает срок по порталу'),
    summary: L(
      'The first version of the portal is late by a week. Frustrated, but I never checked in midway. Decided on a weekly demo.',
      'Первая версия портала опаздывает на неделю. Злюсь, но и сам не проверял прогресс по ходу. Решил ввести еженедельное демо.',
    ),
    text: L(
      `The month is over and there is no portal. Marcus wrote that he is a week behind because of a deadline at his day job. I was angry for an hour, honestly, then I realised I had not asked about progress once since we started. I assumed. Omar keeps asking when the portal comes, and I told him two weeks ago it would be ready. That is on me. Predicted at the start that Marcus would ship on time, eighty-five percent. He did not. Wrong. Now: what do I do. I will not blame him, but we need a weekly demo, fifteen minutes every Friday, so a slip shows up after seven days, not after thirty. Also I should tell Omar the real date, and Priya will probably say I should have seen this coming. She will be right.`,
      `Месяц закончился, а портала нет. Маркус написал, что отстаёт на неделю из-за срока на основной работе. Час я злился, честно, а потом понял, что ни разу не спросил о прогрессе с самого начала. Я просто предполагал. Омар всё время спрашивает про портал, а я две недели назад сказал, что он будет готов. Это на мне. В начале я предсказывал, что Маркус сдаст вовремя, восемьдесят пять процентов. Не сдал. Ошибся. Что теперь делать. Винить его не буду, но нам нужно еженедельное демо, пятнадцать минут каждую пятницу, чтобы срыв был виден через семь дней, а не через тридцать. Ещё нужно сказать Омару реальную дату, а Прия, скорее всего, скажет, что я должен был это предвидеть. И будет права.`,
    ),
    people: ['marcus', 'omar', 'priya'],
    projects: ['app'],
    tags: L(['deadline', 'partner', 'portal'], ['срок', 'партнёр', 'портал']),
  },
  {
    key: 'c-ci-3',
    kind: 'checkin',
    at: { d: 19, t: '09:05' },
    context: 'home',
    title: L('State: waiting', 'Состояние: ожидание'),
    summary: L('Five and a half hours of sleep, nervous about Marcus.', 'Спал пять с половиной часов, нервничаю из-за Маркуса.'),
    text: L(
      `Five and a half hours. Tense about the portal, and the first demo with Marcus is on Friday.`,
      `Пять с половиной часов сна. Напряжён из-за портала, а первое демо с Маркусом в пятницу.`,
    ),
    people: ['marcus'],
    projects: ['app'],
    tags: L(['state', 'sleep'], ['состояние', 'сон']),
  },
  {
    key: 'c-ai-marcus',
    kind: 'ai_chat',
    at: { d: 18, t: '18:15' },
    context: 'home',
    title: L('Chat with Claude: handling a missed deadline', 'Чат с Claude: как говорить о сорванном сроке'),
    summary: L(
      'Cut the portal to what customers asked for and agreed on a feature list for the next two weeks.',
      'Сократил портал до того, о чём просили пользователи, и согласовал список функций на ближайшие две недели.',
    ),
    text: L(
      `Me: My part-time developer missed a deadline by a week. I want to talk to him without blaming him. What should I say?

Claude: Start with the facts and your own part: "The date slipped and I did not check in midway, that is on me." Then ask what got in the way, not who is at fault. Then decide the next step together: reduce scope or move the date, not both silently.

Me: I think reducing scope is better. Omar wants recurring invoices and a logo on the portal. That is the core.

Claude: Then say that: "Let us cut the first version to those two things and ship that." Put the list in writing, agree on a demo every Friday and a date for the cut version.

Me: Okay. I will propose a cut version in two weeks with only invoices and the logo.

Claude: Good. And ask if he needs anything from you to make that date.`,
      `Я: Разработчик на частичной занятости сорвал срок на неделю. Хочу поговорить с ним без обвинений. Что сказать?

Claude: Начните с фактов и своей части: «Срок сдвинулся, и я не проверял прогресс по ходу, это на мне». Потом спросите, что помешало, а не кто виноват. Затем вместе решите следующий шаг: сократить объём или сдвинуть дату, но не оба молча.

Я: Думаю, лучше сократить объём. Омар хочет регулярные счета и логотип на портале. Это ядро.

Claude: Тогда так и скажите: «Давай сократим первую версию до этих двух вещей и выпустим её». Запишите список, договоритесь о демо каждую пятницу и о дате сокращённой версии.

Я: Хорошо. Предложу сокращённую версию через две недели, только счета и логотип.

Claude: Отлично. И спросите, нужно ли ему что-то от вас, чтобы успеть к этой дате.`,
    ),
    people: ['marcus'],
    projects: ['app'],
    tags: L(['partner', 'scope', 'AI chat'], ['партнёр', 'объём', 'ИИ-чат']),
    source: { app: 'Claude', importedFrom: 'claude' },
  },
  {
    key: 'c-mentor-2',
    kind: 'voice',
    at: { d: 17, t: '19:40' },
    context: 'walk',
    title: L('Priya: CAC, LTV and hobby versus business', 'Прия: CAC, LTV и хобби против бизнеса'),
    summary: L(
      'Priya asked me to compute CAC and LTV and warned that I run the product like a hobby. A weekly demo with Marcus is now required.',
      'Прия попросила посчитать CAC и LTV и предупредила, что я веду продукт как хобби. Еженедельное демо с Маркусом теперь обязательно.',
    ),
    text: L(
      `Second talk with Priya. She said four things. First: calculate CAC and LTV, even rough ones, and send them to her by the end of the week. Second: I run Lumen like a hobby, I work on what I enjoy, not on what moves the numbers. Third: a weekly demo with Marcus is not optional, and she was glad I already decided it. Fourth: Ben is a good move, but I must stop doing everything myself. She also asked whether I know how long the average customer stays. I did not. Maybe seven months, but that is a guess. Okay. Ben starts feeling real, Omar is waiting for the portal. Commitment: send Priya CAC and LTV by Friday. I also need to remember she wants to see the pricing results after two weeks.`,
      `Второй разговор с Прией. Она сказала четыре вещи. Первое: посчитать CAC и LTV, пусть грубо, и прислать ей до конца недели. Второе: я веду Lumen как хобби, занимаюсь тем, что мне нравится, а не тем, что двигает цифры. Третье: еженедельное демо с Маркусом не обсуждается, и она была рада, что я уже это решил. Четвёртое: Бен — хороший шаг, но надо перестать делать всё самому. Ещё она спросила, знаю ли я, сколько в среднем остаётся клиент. Не знал. Может, семь месяцев, но это догадка. Ладно. Бен становится реальностью, Омар ждёт портал. Обязательство: до пятницы отправить Прие CAC и LTV. И не забыть, что она хочет увидеть итоги по цене через две недели.`,
    ),
    people: ['priya', 'marcus', 'omar', 'ben'],
    projects: ['app', 'team'],
    tags: L(['mentor', 'metrics', 'focus'], ['ментор', 'метрики', 'фокус']),
    pinned: true,
  },
  {
    key: 'c-hana',
    kind: 'voice',
    at: { d: 15, t: '17:25' },
    context: 'transit',
    title: L('Hana from the agency is silent', 'Хана из агентства молчит'),
    summary: L(
      'Hana asked about a team plan and went quiet after my reply. I keep avoiding the follow-up. I promised Ben one more question.',
      'Хана спросила про командный тариф и замолчала после моего ответа. Я продолжаю избегать повторного сообщения. Пообещал Бену ещё один ответ.',
    ),
    text: L(
      `On the train again. Hana, who owns a five-person agency, asked about the team plan, and I replied with a long message. Since then silence. Part of me wants to write again and part of me does not want to look pushy. I notice that I put off exactly the messages that could close a deal. Prediction: she answers within a week, thirty-five percent. Task: write a short, friendly follow-up with one question, today, not after dinner. And one more commitment: Ben asked a question about the file structure and I said I would reply tomorrow, which turned into three days. Lesson: a short answer now is better than a good one later.`,
      `Опять в электричке. Хана, которая руководит агентством на пять человек, спросила про командный тариф, и я ответил длинным сообщением. С тех пор тишина. Одна часть меня хочет написать ещё, другая не хочет выглядеть навязчивой. Замечаю, что откладываю как раз те сообщения, которые могли бы закрыть сделку. Прогноз: она ответит в течение недели, тридцать пять процентов. Задача: написать короткое дружелюбное сообщение с одним вопросом сегодня, а не после ужина. И ещё обязательство: Бен спросил про структуру файлов, а я сказал, что отвечу завтра, и это превратилось в три дня. Урок: короткий ответ сейчас лучше хорошего потом.`,
    ),
    people: ['hana', 'ben', 'priya'],
    projects: ['app', 'studio'],
    tags: L(['lead', 'follow-up', 'avoiding'], ['лид', 'follow-up', 'избегание']),
  },
  {
    key: 'c-contract',
    kind: 'voice',
    at: { d: 14, t: '21:00' },
    context: 'home',
    title: L('The agreement with Marcus', 'Договорённость с Маркусом'),
    summary: L(
      'Marcus wants 20% now. I decided on 15% revenue share, a 12-month term and a three-month cliff, in a contract from a lawyer.',
      'Маркус хочет 20% сейчас. Я решил: 15% с выручки, срок 12 месяцев, клифф три месяца, договор через юриста.',
    ),
    text: L(
      `Marcus asked for twenty percent after the missed date, which is a funny reaction. I thought about it for a day. Decision: fifteen percent of revenue for twelve months, a three-month cliff, and a contract written by a lawyer, not a chat message. If the first stage is shipped on time and customers use it, we can raise it later. I talked to Maya and she asked the fair question: what if he leaves in month two? With a cliff, he leaves without a share. I will ask the lawyer for a draft by the end of next week. Prediction: Marcus agrees to fifteen with the cliff, sixty-five percent. Alternative if he refuses: pay him per milestone and keep the product rights entirely mine. Parked that idea for now.`,
      `Маркус после сорванного срока попросил двадцать процентов, смешная реакция. Я думал об этом сутки. Решение: пятнадцать процентов с выручки на двенадцать месяцев, клифф три месяца и договор от юриста, а не сообщение в чате. Если первый этап выйдет в срок и пользователи им пользуются, потом можно увеличить. Я поговорил с Майей, и она задала честный вопрос: а что, если он уйдёт на втором месяце? С клиффом он уйдёт без доли. Попрошу у юриста проект договора к концу следующей недели. Прогноз: Маркус согласится на пятнадцать с клиффом, шестьдесят пять процентов. Запасной вариант, если откажется: платить за этапы и оставить права на продукт полностью за собой. Пока отложил эту идею.`,
    ),
    people: ['marcus', 'maya'],
    projects: ['app'],
    tags: L(['partner', 'contract', 'decision'], ['партнёр', 'договор', 'решение']),
  },
  {
    key: 'c-long-run',
    kind: 'voice',
    at: { d: 13, t: '16:30' },
    context: 'walk',
    title: L('A good run with Theo', 'Хорошая пробежка с Тео'),
    summary: L(
      'Ran fourteen kilometres with Theo on seven hours of sleep and felt great. Lesson: switching off the laptop for a day works.',
      'Пробежал с Тео четырнадцать километров, поспав семь часов, и чувствовал себя отлично. Вывод: выключить ноутбук на день работает.',
    ),
    text: L(
      `Fourteen kilometres with Theo, and it was easy. Slept seven hours, ate normally, no laptop since yesterday evening. After the run we sat in a cafe and I did not look at my phone for an hour. That has not happened for months. Lesson: when I switch everything off for a day, I come back with more energy, not less. Idea: a standing Saturday morning with no screens until noon. I want that to be a rule and not a mood. Theo said I look better than two weeks ago.`,
      `Четырнадцать километров с Тео, и всё было легко. Спал семь часов, нормально поел, без ноутбука со вчерашнего вечера. После пробежки мы сидели в кафе, и я целый час не смотрел в телефон. Такого не было месяцами. Вывод: когда я на день выключаю всё, возвращаюсь с большей энергией, а не с меньшей. Идея: постоянное субботнее утро без экранов до полудня. Хочу, чтобы это было правилом, а не настроением. Тео сказал, что я выгляжу лучше, чем две недели назад.`,
    ),
    people: ['theo'],
    projects: ['run'],
    tags: L(['running', 'rest', 'friends'], ['бег', 'отдых', 'друзья']),
  },
  {
    key: 'c-raise-ben',
    kind: 'voice',
    at: { d: 12, t: '18:45' },
    context: 'walk',
    title: L('Ben’s rate goes up', 'Ставка Бена растёт'),
    summary: L(
      'Raising Ben’s rate to $45 after the trial month, as long as he takes over client updates. Sam asked for a mentoring session.',
      'Повышаю ставку Бена до $45 после пробного месяца, если он возьмёт на себя отчёты клиентам. Сэм просила занятие по менторству.',
    ),
    text: L(
      `Big day. Ben finished the trial month and I decided to raise his rate from forty to forty-five dollars an hour from next month, on condition that he takes over written updates to clients. He agreed. That frees about four hours a week for me, which goes straight into Lumen. The question I had is whether to hire a second contractor, and I decided not yet. First I want Ben's work to be visible in the numbers. Also Sam wrote that she wants a mentoring session this week, and Marcus says the demo on Friday will show the invoice part. Prediction: Marcus shows a working invoice flow on Friday, thirty-five percent. Let us see. Nina's project is at the stage where she asks every day how it is going, so Ben's updates will matter.`,
      `Важный день. Бен закончил пробный месяц, и я решил поднять его ставку с сорока до сорока пяти долларов в час со следующего месяца при условии, что он берёт на себя письменные отчёты клиентам. Он согласился. Это освободит около четырёх часов в неделю, которые сразу пойдут в Lumen. Вопрос был, нанимать ли второго подрядчика, и я решил, что пока нет. Сначала хочу увидеть работу Бена в цифрах. Ещё Сэм написала, что хочет занятие по менторству на этой неделе, а Маркус говорит, что демо в пятницу покажет часть со счетами. Прогноз: Маркус покажет рабочий поток счетов в пятницу, тридцать пять процентов. Посмотрим. Проект Нины на той стадии, когда она каждый день спрашивает, как дела, так что отчёты Бена будут важны.`,
    ),
    people: ['ben', 'marcus', 'sam', 'nina'],
    projects: ['team', 'studio', 'app'],
    tags: L(['hiring', 'rates', 'delegating'], ['найм', 'ставки', 'делегирование']),
    pinned: true,
  },
];
