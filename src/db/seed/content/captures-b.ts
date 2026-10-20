import { pick as L } from '../../../i18n';
import type { CaptureSpec } from '../specs';

/** Days 40–22 ago: customer interviews, a contractor, the price change, a hard client. */
export const capturesB = (): CaptureSpec[] => [
  {
    key: 'c-interviews',
    kind: 'voice',
    at: { d: 40, t: '18:30' },
    context: 'walk',
    title: L('Four customer interviews', 'Четыре интервью с пользователями'),
    summary: L(
      'Talked to four customers. Three want recurring invoices, nobody mentioned the dashboard I spent a week on. Follow-ups matter more than features.',
      'Поговорил с четырьмя пользователями. Трое хотят регулярные счета, про дашборд, на который я потратил неделю, никто не вспомнил. Напоминания важнее функций.',
    ),
    text: L(
      `Four customer calls this week, and I want to write down what I learned before it fades. Omar, the illustrator, asked for recurring invoices for the second time. Two other users asked for the same thing without being prompted. Nobody mentioned the dashboard I spent a whole week on. I felt a bit stupid, but better to know now. What people do like is that Lumen sends a polite reminder when an invoice is late, so they do not have to chase clients themselves. So the lesson is simple: reminders and recurring invoices matter more than anything pretty. Another lesson: when I ask what they would pay for, they give vague answers, but when I ask what annoyed them last month, they give specifics. I should ask the second kind of question more often. Idea: a small automatic follow-up that nudges a client after a few days of silence. Omar also said he would pay more for a client portal with his own logo, which fits Marcus's version two. And the conversion from trial to paid is thirty-three percent as far as I can count, though I only have a rough number.`,
      `На этой неделе четыре звонка с пользователями, и хочу записать, что узнал, пока не забылось. Омар, иллюстратор, во второй раз попросил регулярные счета. Двое других пользователей без подсказки попросили то же самое. Про дашборд, на который я потратил целую неделю, никто не вспомнил. Было немного обидно, но лучше узнать сейчас. Людям нравится, что Lumen сам вежливо напоминает о просроченном счёте, и им не надо самим догонять клиентов. Так что вывод простой: напоминания и регулярные счета важнее любой красоты. Ещё вывод: когда я спрашиваю, за что они заплатили бы, ответы расплывчатые, а когда спрашиваю, что раздражало в прошлом месяце, получаю конкретику. Надо чаще задавать вопросы второго типа. Идея: маленькое автоматическое напоминание, которое подталкивает клиента после нескольких дней тишины. Ещё Омар сказал, что заплатил бы больше за клиентский портал со своим логотипом, и это ложится на версию два Маркуса. А конверсия из пробного периода в платный — тридцать три процента, насколько я могу посчитать, хотя цифры грубые.`,
    ),
    people: ['omar'],
    projects: ['app'],
    tags: L(['research', 'users', 'reminders'], ['исследование', 'пользователи', 'напоминания']),
  },
  {
    key: 'c-hire-ben',
    kind: 'voice',
    at: { d: 38, t: '20:00' },
    context: 'home',
    title: L('Hiring Ben for overflow studio work', 'Нанимаю Бена на переполнение студийной работы'),
    summary: L(
      'Decided to hire Ben as a contract designer at $40 an hour for a month. Priya warned me to define handover before day one.',
      'Решил нанять Бена контрактным дизайнером по $40 в час на месяц. Прия предупредила: опиши передачу задач до первого дня.',
    ),
    text: L(
      `Big step: I am hiring Ben. He is a designer I met at a meetup, careful with details, and I have too much studio work for three days a week. Decided: Ben works as a contractor, forty dollars an hour, a trial month, up to ten hours a week. Alternatives I considered: say no to some projects, or raise my rates so that I need fewer clients. I am doing the hiring because Nina's project is large and I do not want to lose her. Priya, when I called, said the thing that matters is handover: write down how I work, where files live and what good looks like before his first day. I promised to write that document before Ben starts. Ben said he can start in a week. I think there is a seventy percent chance he delivers the first screens on time, probably a bit more because he already sent me a nice portfolio. I also need to remember Sam is waiting for my feedback on her portfolio, I keep postponing it.`,
      `Большой шаг: я нанимаю Бена. Это дизайнер, с которым я познакомился на митапе, он внимателен к деталям, а у меня слишком много студийной работы для трёх дней в неделю. Решил: Бен работает подрядчиком, сорок долларов в час, пробный месяц, до десяти часов в неделю. Альтернативы, которые я рассматривал: отказаться от части проектов или поднять ставки, чтобы нужно было меньше клиентов. Нанимаю потому, что проект Нины большой и я не хочу её потерять. Прия, когда я позвонил, сказала, что главное — передача задач: до первого дня Бена записать, как я работаю, где лежат файлы и что считается хорошим результатом. Я пообещал написать такой документ до того, как Бен начнёт. Бен сказал, что может стартовать через неделю. Думаю, вероятность того, что он сдаст первые экраны вовремя, семьдесят процентов, скорее чуть больше, потому что он уже прислал хорошее портфолио. И надо не забыть, что Сэм ждёт моего отзыва на портфолио, я всё откладываю.`,
    ),
    people: ['ben', 'priya', 'sam', 'nina'],
    projects: ['team', 'studio'],
    tags: L(['hiring', 'contractor', 'delegating'], ['найм', 'подрядчик', 'делегирование']),
  },
  {
    key: 'c-price-raise',
    kind: 'voice',
    at: { d: 36, t: '19:20' },
    context: 'walk',
    title: L('Raising the price from $9 to $12', 'Поднимаю цену с $9 до $12'),
    summary: L(
      'Decided to raise the price of Lumen from $9 to $12 for new users, keeping old users on $9. Expecting trial conversion to hold above 30%.',
      'Решил поднять цену Lumen с $9 до $12 для новых пользователей, старые остаются на $9. Жду, что конверсия пробного периода останется выше 30%.',
    ),
    text: L(
      `I finally made a decision about price. After the interviews and the talk with Priya, I am raising the price of Lumen from nine to twelve dollars a month for new users, and the old users stay on nine as a thank you. Priya's argument: if nobody ever says it is expensive, it is too cheap. Theo said the same weeks ago. My fear is that conversion drops. The conversion today is about thirty-three percent, and I expect it to stay above thirty, let's say eighty percent sure. A third of the effect is just that the new price looks more serious. I will watch two numbers: conversion of trials and the number of cancellations in the first month. Review in two weeks. Also, something I noticed: I am not charging less because I am nervous, I am charging less because I do not believe the product is worth more. That is a belief I should test, not feel. Also a fact: the price is now twelve dollars, and I will mention it in the newsletter next week. Omar will probably tell me the old price was better, that is fine. The number of paying users is thirty-eight today, up from twenty-seven.`,
      `Я наконец принял решение по цене. После интервью и разговора с Прией поднимаю цену Lumen с девяти до двенадцати долларов в месяц для новых пользователей, а старые остаются на девяти в благодарность. Аргумент Прии: если никто никогда не говорит, что дорого, значит, слишком дёшево. Тео говорил то же самое несколько недель назад. Я боюсь, что конверсия упадёт. Сейчас конверсия около тридцати трёх процентов, и я ожидаю, что она останется выше тридцати, скажем, уверенность восемьдесят процентов. Треть эффекта — просто то, что новая цена выглядит серьёзнее. Буду смотреть два числа: конверсию пробных периодов и число отмен в первый месяц. Пересмотр через две недели. И ещё заметил: я не потому беру меньше, что нервничаю, а потому, что не верю, что продукт стоит больше. Это убеждение надо проверять, а не чувствовать. И факт: цена теперь двенадцать долларов, и на следующей неделе я упомяну это в рассылке. Омар, наверное, скажет, что прежняя цена была лучше, это нормально. Платящих пользователей сегодня тридцать восемь, было двадцать семь.`,
    ),
    people: ['priya', 'omar', 'theo'],
    projects: ['app', 'news'],
    tags: L(['pricing', 'decision', 'conversion'], ['цена', 'решение', 'конверсия']),
    pinned: true,
  },
  {
    key: 'c-ci-2',
    kind: 'checkin',
    at: { d: 34, t: '07:55' },
    context: 'home',
    title: L('State: foggy', 'Состояние: туман в голове'),
    summary: L('Worked until two at night, slept four and a half hours.', 'Работал до двух ночи, спал четыре с половиной часа.'),
    text: L(
      `Sat on the invoice export until two at night. Slept four and a half hours. Coffee does not help, and Ben's first screens arrive today.`,
      `Просидел над экспортом счетов до двух ночи. Спал четыре с половиной часа. Кофе не помогает, а сегодня Бен присылает первые экраны.`,
    ),
    people: ['ben'],
    projects: ['team'],
    tags: L(['state', 'sleep'], ['состояние', 'сон']),
  },
  {
    key: 'c-ai-outreach',
    kind: 'ai_chat',
    at: { d: 33, t: '22:40' },
    context: 'home',
    title: L('Chat with ChatGPT: a short outreach email', 'Чат с ChatGPT: короткое письмо-знакомство'),
    summary: L(
      'Wrote a short, honest email for newsletter readers who have not tried Lumen yet. Decided to send it to ten people first.',
      'Составил короткое честное письмо для читателей рассылки, которые ещё не пробовали Lumen. Решил сначала отправить его десяти людям.',
    ),
    text: L(
      `Me: Help me write a short email to readers of my newsletter who have not tried Lumen. It should not sound like a sales pitch.

ChatGPT: Start with a specific problem you know they have: chasing late invoices. Then one sentence about what Lumen does, one about the free trial, and a simple question at the end. For example: "I noticed you asked about late-paying clients last week. Lumen sends polite reminders for you. Want a link to try it for 14 days?"

Me: Good. Make it shorter and more human.

ChatGPT: "Hi Sam, you mentioned late invoices. I built a small tool that nudges clients for you: lumen.example. Free for 14 days, no card. Curious if it would help." Subject: "Late invoices?"

Me: Great, I will send this to ten readers first and see how many reply.

ChatGPT: Track replies, not opens. If three or more answer, scale it up slowly. If none, change the question, not the tool.`,
      `Я: Помоги написать короткое письмо читателям моей рассылки, которые ещё не пробовали Lumen. Оно не должно звучать как продажа.

ChatGPT: Начни с конкретной проблемы, которая у них точно есть: догонять просроченные счета. Потом одно предложение о том, что делает Lumen, одно о бесплатном пробном периоде и простой вопрос в конце. Например: «Я заметил, что на прошлой неделе вы спрашивали про клиентов, которые платят поздно. Lumen сам вежливо напоминает им. Прислать ссылку на 14 дней?»

Я: Хорошо. Сделай короче и человечнее.

ChatGPT: «Привет, Сэм, вы упоминали просроченные счета. Я сделал небольшой инструмент, который сам подталкивает клиентов: lumen.example. 14 дней бесплатно, без карты. Интересно, поможет ли». Тема: «Просроченные счета?»

Я: Отлично, сначала отправлю это десяти читателям и посмотрю, сколько ответят.

ChatGPT: Считай ответы, а не открытия. Если ответят трое или больше, масштабируй понемногу. Если никто, меняй вопрос, а не инструмент.`,
    ),
    projects: ['news', 'app'],
    tags: L(['outreach', 'AI chat'], ['письма', 'ИИ-чат']),
    source: { app: 'ChatGPT', importedFrom: 'chatgpt' },
  },
  {
    key: 'c-bad-run',
    kind: 'voice',
    at: { d: 31, t: '16:10' },
    context: 'transit',
    title: L('A bad long run after a short night', 'Плохая длинная пробежка после короткой ночи'),
    summary: L(
      'The Saturday long run fell apart after four hours of sleep. The lesson: sleep counts as training. Cut the next long run by a third.',
      'Субботняя длинная пробежка развалилась после четырёх часов сна. Вывод: сон — это тоже тренировка. Следующую длинную сократить на треть.',
    ),
    text: L(
      `On the bus back from the run, so I will be quick. I wanted fourteen kilometres and stopped at nine. Four hours of sleep the night before, I had been shipping a release until two. My legs were fine but my head was not. Coach Dana will be unhappy, she wrote in the plan that sleep counts as training. Prediction I made earlier was that I would finish the long run, seventy percent. Wrong. Lesson: a short night costs more than a missed workout, and I keep pretending it does not. Decided to cut the next long run by a third and go to bed before midnight on Fridays. I need to tell Dana what happened. Question: is it worth running at all after fewer than five hours of sleep?`,
      `В автобусе после пробежки, так что коротко. Хотел четырнадцать километров, остановился на девяти. Накануне спал четыре часа, до двух ночи выпускал релиз. Ноги были в порядке, а голова нет. Тренер Дана будет недовольна, у неё в плане написано, что сон — это тоже тренировка. Прогноз, который я делал раньше, — что закончу длинную пробежку, семьдесят процентов. Не сбылся. Вывод: короткая ночь обходится дороже пропущенной тренировки, а я всё делаю вид, что нет. Решил сократить следующую длинную на треть и по пятницам ложиться до полуночи. Надо рассказать Дане, что случилось. Вопрос: стоит ли вообще бегать, если спал меньше пяти часов?`,
    ),
    people: ['dana'],
    projects: ['run'],
    tags: L(['running', 'sleep'], ['бег', 'сон']),
  },
  {
    key: 'c-teamplan',
    kind: 'voice',
    at: { d: 30, t: '19:35' },
    context: 'walk',
    title: L('Team plan goes live', 'Командный тариф запущен'),
    summary: L(
      'Launched the team plan. Expecting at least five teams in two weeks, but not more than six. Promised Omar the recurring invoices.',
      'Запустил командный тариф. Жду минимум пять команд за две недели, но не больше шести. Обещал Омару регулярные счета.',
    ),
    text: L(
      `The team plan is live. It took the whole weekend, but it is out: one price for up to five people, shared clients and one invoice history. I posted it in the newsletter and sent it to Omar first. I expect at least five teams to sign up in the next two weeks, eighty percent sure. I would be surprised by more than six, though I cannot rule it out, maybe thirty percent. Omar replied in ten minutes with two bugs and a happy face. I promised him recurring invoices in the next release, and I mean it, because it is the third time someone asked. Decision for the next week: no new features until the team plan is stable. Done is better than pretty.`,
      `Командный тариф запущен. Ушли все выходные, но он вышел: одна цена на пять человек, общие клиенты и единая история счетов. Я написал о нём в рассылке и первым отправил Омару. Ожидаю как минимум пять команд за ближайшие две недели, уверенность восемьдесят процентов. Больше шести удивило бы меня, хотя исключить нельзя, процентов тридцать. Омар ответил за десять минут двумя багами и улыбкой. Я пообещал ему регулярные счета в следующем релизе и действительно сделаю, потому что просят в третий раз. Решение на неделю: никаких новых функций, пока командный тариф не стабилен. Готовое лучше красивого.`,
    ),
    people: ['omar'],
    projects: ['app'],
    tags: L(['launch', 'team plan'], ['запуск', 'командный тариф']),
  },
  {
    key: 'c-taxes',
    kind: 'text',
    dictated: true,
    at: { d: 28, t: '14:20' },
    context: 'work',
    title: L('Quarterly taxes and Ben’s payment', 'Квартальные налоги и оплата Бену'),
    summary: L(
      'Need to set up quarterly tax payments and pay Ben for his first invoice. A separate account for taxes is the fix.',
      'Нужно настроить квартальные налоговые платежи и оплатить первый счёт Бена. Решение — отдельный счёт для налогов.',
    ),
    text: L(
      `Two things to do about money. First, pay Ben for his first invoice this week, eight hundred dollars, he did not chase me, which makes me want to pay on time. Second, taxes. I have been mixing business and personal money and last quarter's tax was a surprise. Decided: open a separate account and move thirty percent of every payment into it the day it arrives. Is a legal entity worth it at this size? Not sure, I should ask an accountant. Predicted that the ads test would pay for itself, sixty percent. Will check results tomorrow. Mom's old card is still the one used for the domain, I should change that.`,
      `Два дела про деньги. Во-первых, на этой неделе оплатить Бену первый счёт, восемьсот долларов, он не напоминал, и от этого хочется платить вовремя. Во-вторых, налоги. Я смешиваю деньги бизнеса и личные, и налог за прошлый квартал был неприятным сюрпризом. Решил: открыть отдельный счёт и переводить на него тридцать процентов каждого платежа в день поступления. Нужно ли юрлицо при таком размере? Не уверен, надо спросить бухгалтера. Предсказывал, что тест рекламы окупится, шестьдесят процентов. Результаты проверю завтра. Домен всё ещё оплачивается старой маминой картой, это надо поменять.`,
    ),
    people: ['ben', 'mom'],
    projects: ['team', 'studio'],
    tags: L(['money', 'taxes'], ['деньги', 'налоги']),
  },
  {
    key: 'c-greg-price',
    kind: 'voice',
    at: { d: 26, t: '18:50' },
    context: 'walk',
    title: L('Greg haggles over the quote', 'Грег торгуется по смете'),
    summary: L(
      'Greg finds the quote too high and wants a discount. I kept postponing the call, again. Promised to answer him by tomorrow.',
      'Грегу смета кажется высокой, он хочет скидку. Я опять откладывал звонок. Пообещал ответить до завтра.',
    ),
    text: L(
      `Greg again. He said the quote for the furniture shop site is too high, that a competitor offered half. I did not answer for three days, I find these conversations draining. This is a pattern, I notice: the hard call goes to the end of the day, then to tomorrow. Today he finally called me. I was calm. I said the price includes the product pages and the photo set, and I promised to send him a clear breakdown by tomorrow so he can see where the money goes. He said fine, but he wants to think about paying in advance with a discount. I will consider ten percent. I predict he will pay the first part within a week, seventy-five percent sure. We will see. Lesson for myself: respond the same day, even if it is just "I will answer tomorrow".`,
      `Опять Грег. Сказал, что смета на сайт мебельного магазина слишком высокая и что конкурент предложил вдвое меньше. Я три дня не отвечал, такие разговоры меня вымотывают. Замечаю закономерность: неприятный звонок уезжает в конец дня, потом на завтра. Сегодня он наконец позвонил сам. Я был спокоен. Сказал, что в цену входят страницы товаров и фотосессия, и пообещал прислать понятную разбивку до завтра, чтобы он видел, куда уходят деньги. Он сказал «ладно», но хочет подумать об оплате вперёд со скидкой. Рассмотрю десять процентов. Прогнозирую, что первую часть он оплатит в течение недели, уверенность семьдесят пять процентов. Посмотрим. Урок себе: отвечать в тот же день, даже если это просто «отвечу завтра».`,
    ),
    people: ['greg'],
    projects: ['studio'],
    tags: L(['client', 'price', 'avoiding'], ['клиент', 'цена', 'избегание']),
  },
  {
    key: 'c-greg-discount',
    kind: 'voice',
    at: { d: 24, t: '21:30' },
    context: 'home',
    title: L('A 10% discount for paying upfront', 'Скидка 10% за предоплату'),
    summary: L(
      'Greg agreed to pay in advance with a 10% discount. Priya reminded me to sell value instead of lowering the price. I will invoice him tomorrow.',
      'Грег согласился на предоплату со скидкой 10%. Прия напомнила продавать ценность, а не снижать цену. Завтра выставлю счёт.',
    ),
    text: L(
      `Greg called back and agreed to pay for the whole project upfront with a ten percent discount. I told Priya on the phone and she was not pleased: she said I should sell the value, not the discount. She is right in general, but upfront payment helps my cash and the project is small. I decided to offer the discount this time only, and write the reasons into the invoice. I will send the invoice tomorrow morning. Important lesson: a discount is for something, here for cash up front, never just because someone asks. I also want to avoid the next conversation like this one, so I will put payment terms in every quote. Not sleeping well, again, it is past midnight.`,
      `Грег перезвонил и согласился оплатить весь проект вперёд со скидкой десять процентов. Я рассказал Прие по телефону, и она была недовольна: сказала, что надо продавать ценность, а не скидку. В целом она права, но предоплата помогает моему денежному потоку, и проект небольшой. Решил предложить скидку только в этот раз и записать причины в счёт. Счёт отправлю завтра утром. Важный вывод: скидка даётся за что-то, здесь за предоплату, а не просто потому, что попросили. Хочу избежать такого разговора в будущем, поэтому буду вписывать условия оплаты в каждую смету. Опять плохо сплю, уже за полночь.`,
    ),
    people: ['greg', 'priya'],
    projects: ['studio'],
    tags: L(['client', 'discount', 'sleep'], ['клиент', 'скидка', 'сон']),
  },
  {
    key: 'c-ads-result',
    kind: 'text',
    dictated: true,
    at: { d: 22, t: '12:00' },
    context: 'work',
    title: L('Ads test did not pay back', 'Тест рекламы не окупился'),
    summary: L(
      'Spent $300 on ads, got 6 trials and 1 paying user. The newsletter brought 190 subscribers for free. Stop ads, double down on the newsletter.',
      'Потратил $300 на рекламу, получил 6 пробных и 1 платящего. Рассылка бесплатно привела 190 подписчиков. Рекламу останавливаю, делаю ставку на рассылку.',
    ),
    text: L(
      `The ads test is over. Three hundred dollars, six trials, one paying user. That is a CAC of three hundred for a twelve-dollar-a-month customer, nowhere near good. The newsletter, in the same period, brought 190 subscribers at no cost and eight trials. Priya's comment: ads are for when the funnel is proven, and mine is not. Idea: run small ad tests only to learn which message works, with a hard limit of fifty dollars each. Scaling ads is dropped. I predicted this test would pay for itself, sixty percent. It did not. Subscribers are now five hundred and twenty.`,
      `Тест рекламы закончен. Триста долларов, шесть пробных периодов, один платящий пользователь. Это CAC триста долларов для клиента с двенадцатью долларами в месяц, очень плохо. Рассылка за тот же период бесплатно принесла 190 подписчиков и восемь пробных периодов. Комментарий Прии: реклама нужна, когда воронка проверена, а у меня нет. Идея: запускать небольшие рекламные тесты только чтобы понять, какое сообщение работает, с жёстким лимитом пятьдесят долларов на каждый. Масштабирование рекламы отменяю. Я предсказывал, что тест окупится, шестьдесят процентов. Не окупился. Подписчиков теперь пятьсот двадцать.`,
    ),
    people: ['priya'],
    projects: ['app', 'news'],
    tags: L(['ads', 'newsletter', 'CAC'], ['реклама', 'рассылка', 'CAC']),
  },
];
