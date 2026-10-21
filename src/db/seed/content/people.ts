import { pick as L } from '../../../i18n';
import type { PersonSpec, ProjectSpec } from '../specs';

/** The cast of the demo: a fictional freelance designer, his customers, his developer, mentor and family. */
export const peopleSpecs = (): PersonSpec[] => [
  {
    key: 'nina',
    name: L('Nina Brandt', 'Нина Бранд'),
    aliases: L(['Nina', 'Nina B.', 'Brandt Studio'], ['Нина', 'Нина Б.', 'студия Бранд']),
    role: 'client',
    notes: L(
      'Runs a small brand agency and is the anchor client of my studio work. Pays on time, wants short written updates after each milestone, and has hinted at a long retainer.',
      'Руководит небольшим брендинговым агентством и остаётся главным клиентом моей студийной работы. Платит в срок, ждёт короткий отчёт после каждого этапа и намекала на долгий контракт.',
    ),
    mood: 0.7,
  },
  {
    key: 'omar',
    name: L('Omar Haddad', 'Омар Хаддад'),
    aliases: L(['Omar', 'Omar H.'], ['Омар', 'Омар Х.']),
    role: 'client',
    notes: L(
      'Freelance illustrator, the heaviest user of Lumen. Sends precise bug reports and feature ideas, asked for recurring invoices twice. Would pay more for a client portal with his own logo.',
      'Фрилансер-иллюстратор, самый активный пользователь Lumen. Присылает точные баг-репорты и идеи, дважды просил регулярные счета. Заплатил бы больше за клиентский портал со своим логотипом.',
    ),
    mood: 0.5,
  },
  {
    key: 'greg',
    name: L('Greg Lowell', 'Грег Лоуэлл'),
    aliases: L(['Greg', 'Gregory Lowell'], ['Грег', 'Грегори Лоуэлл']),
    role: 'client',
    notes: L(
      'Owner of a furniture shop, hired me to redo the site. Haggles on every quote and pays late. Responds to numbers and deadlines, not to long explanations.',
      'Владелец мебельного магазина, заказал у меня новый сайт. Торгуется по каждой смете и платит с опозданием. Реагирует на цифры и сроки, а не на длинные объяснения.',
    ),
    mood: -0.3,
  },
  {
    key: 'hana',
    name: L('Hana Kimura', 'Хана Кимура'),
    aliases: L(['Hana', 'Hana K.'], ['Хана', 'Хана К.']),
    role: 'client',
    notes: L(
      'Owns a five-person design agency and asked about a team plan for Lumen. Wanted a call before committing, and has not answered since my last message.',
      'Владелица дизайн-агентства на пять человек, спрашивала про командный тариф Lumen. Хотела созвониться перед решением и не отвечает после моего последнего сообщения.',
    ),
    mood: -0.1,
  },
  {
    key: 'marcus',
    name: L('Marcus Lee', 'Маркус Ли'),
    aliases: L(['Marcus', 'Marc', 'Marcus L.'], ['Маркус', 'Марк', 'Маркус Л.']),
    role: 'partner',
    notes: L(
      'Part-time developer on Lumen, works evenings next to his day job. Fast and talented, but misses dates. We agreed a revenue share instead of equity.',
      'Разработчик Lumen на частичной занятости, работает вечерами рядом с основной работой. Быстрый и талантливый, но срывает сроки. Договорились о доле выручки вместо доли в компании.',
    ),
    mood: -0.1,
  },
  {
    key: 'ben',
    name: L('Ben Okafor', 'Бен Окафор'),
    aliases: L(['Ben', 'Benny'], ['Бен', 'Бенни']),
    role: 'teammate',
    notes: L(
      'Contract designer I hired for overflow studio work. Careful with details, sends progress without being asked. Rate is $40 an hour, going up to $45 after the trial month.',
      'Дизайнер на контракте, которого я нанял на переполнение студийной работы. Внимателен к деталям, сам присылает прогресс. Ставка $40 в час, после пробного месяца будет $45.',
    ),
    mood: 0.6,
  },
  {
    key: 'priya',
    name: L('Priya Raman', 'Прия Раман'),
    aliases: L(['Priya', 'Priya R.'], ['Прия', 'Прия Р.']),
    role: 'mentor',
    notes: L(
      'Sold her own software company two years ago. Meets me every two weeks, asks hard questions about numbers, and does not let me hide behind work I enjoy.',
      'Два года назад продала свою софтверную компанию. Встречаемся раз в две недели, задаёт жёсткие вопросы про цифры и не даёт прятаться за работой, которая мне нравится.',
    ),
    mood: 0.8,
  },
  {
    key: 'theo',
    name: L('Theo Wagner', 'Тео Вагнер'),
    aliases: L(['Theo', 'Theodore'], ['Тео', 'Теодор']),
    role: 'friend',
    notes: L(
      'Friend from university, my running buddy. We run on Saturday mornings; he is the one who tells me when I look exhausted.',
      'Друг с университета, мой напарник по бегу. Бегаем по субботам утром; именно он говорит, когда я выгляжу измотанным.',
    ),
    mood: 0.6,
  },
  {
    key: 'maya',
    name: L('Maya', 'Майя'),
    aliases: L(['Maya R.', 'my partner'], ['Майя Р.', 'моя девушка']),
    role: 'family',
    notes: L(
      'My partner. Supports the leap, but asks for evenings without a laptop. Keeps our shared calendar.',
      'Моя девушка. Поддерживает мой шаг, но просит вечера без ноутбука. Ведёт наш общий календарь.',
    ),
    mood: 0.5,
  },
  {
    key: 'mom',
    name: L('Mom', 'Мама'),
    aliases: L(['Mum', 'my mother'], ['мамуля', 'моя мама']),
    role: 'family',
    notes: L(
      'Calls on Sundays. Worries that I sleep too little and work too late. Right about it more often than I like to admit.',
      'Звонит по воскресеньям. Переживает, что я мало сплю и поздно работаю. Права чаще, чем мне хочется признавать.',
    ),
    mood: 0.3,
  },
  {
    key: 'sam',
    name: L('Sam Ortiz', 'Сэм Ортис'),
    aliases: L(['Sam', 'Samantha'], ['Сэм', 'Саманта']),
    role: 'other',
    notes: L(
      'Junior designer I mentor on weekends. Strong visual taste, shy about showing work. Wants to move from agency to product design.',
      'Начинающая дизайнерка, которую я консультирую по выходным. Хороший визуальный вкус, стесняется показывать работы. Хочет перейти из агентства в продуктовый дизайн.',
    ),
    mood: 0.3,
  },
  {
    key: 'dana',
    name: L('Coach Dana', 'Тренер Дана'),
    aliases: L(['Dana', 'Dana Whitlock'], ['Дана', 'Дана Уитлок']),
    role: 'mentor',
    notes: L(
      'Running coach. Wrote my half-marathon plan and insists that sleep counts as training. Strict about rest days.',
      'Тренер по бегу. Составила мой план к полумарафону и настаивает, что сон — это тоже тренировка. Строга к дням отдыха.',
    ),
    mood: 0.2,
  },
];

export const projectSpecs = (): ProjectSpec[] => [
  {
    key: 'app',
    name: 'Lumen',
    kind: 'product',
    status: 'active',
    description: L(
      'My product: invoices and a client portal for freelancers. Paid plan, a small but growing base of users.',
      'Мой продукт: счета и клиентский портал для фрилансеров. Платный тариф, небольшая, но растущая база пользователей.',
    ),
    keywords: L(['lumen', 'invoice', 'portal', 'pricing', 'trial'], ['lumen', 'счёт', 'портал', 'цена', 'пробный период']),
    color: '#6ea8ff',
    startedD: 59,
  },
  {
    key: 'studio',
    name: L('Studio work', 'Студийные заказы'),
    kind: 'business',
    status: 'active',
    description: L(
      'Freelance design projects for clients: sites, brand identities, the work that pays the bills while Lumen grows.',
      'Фриланс-проекты для клиентов: сайты, фирменный стиль. Работа, которая оплачивает счета, пока растёт Lumen.',
    ),
    keywords: L(['client', 'quote', 'invoice', 'brand', 'website'], ['клиент', 'смета', 'счёт', 'бренд', 'сайт']),
    color: '#f2b36b',
    startedD: 59,
  },
  {
    key: 'news',
    name: L('Small Bets newsletter', 'Рассылка «Small Bets»'),
    kind: 'business',
    status: 'active',
    description: L(
      'A weekly newsletter about building small products. The main channel for finding Lumen users.',
      'Еженедельная рассылка о создании небольших продуктов. Главный канал, откуда приходят пользователи Lumen.',
    ),
    keywords: L(['newsletter', 'issue', 'subscribers', 'audience'], ['рассылка', 'выпуск', 'подписчики', 'аудитория']),
    color: '#b79cff',
    startedD: 59,
  },
  {
    key: 'team',
    name: L('Contractors', 'Подрядчики'),
    kind: 'business',
    status: 'active',
    description: L(
      'Hiring and managing contractors: rates, handover, how to delegate without losing quality.',
      'Найм и работа с подрядчиками: ставки, передача задач, как делегировать и не терять качество.',
    ),
    keywords: L(['contractor', 'rate', 'handover', 'delegate'], ['подрядчик', 'ставка', 'передача', 'делегировать']),
    color: '#5fe3b0',
    startedD: 38,
  },
  {
    key: 'run',
    name: L('Half marathon', 'Полумарафон'),
    kind: 'personal',
    status: 'active',
    description: L(
      'Training for a half marathon in December. Sleep, long runs on Saturdays, and not overdoing it.',
      'Подготовка к полумарафону в декабре. Сон, длинные пробежки по субботам и без перегрузок.',
    ),
    keywords: L(['run', 'training', 'sleep', 'race'], ['бег', 'тренировка', 'сон', 'забег']),
    color: '#ff8aa8',
    startedD: 59,
  },
];
