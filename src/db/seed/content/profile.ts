import { pick as L } from '../../../i18n';
import type { GlossaryEntry, Profile } from '../../../domain/types';

const demoGlossary = (): GlossaryEntry[] =>
  L(
    [
      { term: 'Lumen', hint: 'my product: invoices and a client portal for freelancers' },
      { term: 'MRR', hint: 'monthly recurring revenue: what the paying users bring each month' },
      { term: 'churn', hint: 'the share of paying users who cancel in a month' },
      { term: 'trial', hint: 'the 14-day free period of Lumen; the goal is to turn it into a paid plan' },
      { term: 'conversion', hint: 'the share of trials that became paying users' },
      { term: 'CAC', hint: 'what it costs to bring one paying user' },
      { term: 'LTV', hint: 'how much money a user brings over the whole time they stay' },
      { term: 'MVP', hint: 'the first working version of a feature, enough to test the idea' },
      { term: 'vesting', hint: 'a share that is earned gradually instead of all at once' },
      { term: 'retainer', hint: 'a monthly agreement with a studio client for ongoing work' },
      { term: 'runway', hint: 'how many months my savings will last' },
      { term: 'OKR', hint: 'objectives and key results, how I plan a quarter' },
      { term: 'Small Bets', hint: 'my weekly newsletter' },
      { term: 'long run', hint: 'the Saturday long run of the half-marathon plan' },
    ],
    [
      { term: 'Lumen', hint: 'мой продукт: счета и клиентский портал для фрилансеров' },
      { term: 'MRR', hint: 'ежемесячная повторяющаяся выручка: сколько приносят платящие пользователи' },
      { term: 'отток', hint: 'доля платящих пользователей, которые отменяют подписку за месяц' },
      { term: 'пробный период', hint: '14 бесплатных дней Lumen; цель — превратить его в платный тариф' },
      { term: 'конверсия', hint: 'доля пробных периодов, которые стали платными' },
      { term: 'CAC', hint: 'сколько стоит привести одного платящего пользователя' },
      { term: 'LTV', hint: 'сколько денег пользователь приносит за всё время' },
      { term: 'MVP', hint: 'первая рабочая версия функции, достаточная для проверки идеи' },
      { term: 'вестинг', hint: 'доля, которая открывается постепенно, а не сразу' },
      { term: 'ретейнер', hint: 'ежемесячная договорённость со студийным клиентом о постоянной работе' },
      { term: 'runway', hint: 'на сколько месяцев хватит моих сбережений' },
      { term: 'OKR', hint: 'цели и ключевые результаты, так я планирую квартал' },
      { term: 'Small Bets', hint: 'моя еженедельная рассылка' },
      { term: 'длинная', hint: 'субботняя длинная пробежка из плана к полумарафону' },
    ],
  );

/** The "About me" card the demo ships with. `updatedAt` is stamped by the seeding code. */
export function buildDemoProfile(updatedAt: string): Profile {
  return {
    id: 'me',
    name: L('Alex', 'Алекс'),
    about: L(
      'I am a product designer who left an agency seven months ago to build Lumen, a small invoicing and client-portal app for freelancers. I pay the bills with studio work for a handful of clients, write a weekly newsletter, work with one part-time developer and one contract designer, and train for a half marathon.',
      'Я продуктовый дизайнер, семь месяцев назад ушёл из агентства, чтобы делать Lumen — небольшое приложение для счетов и клиентского портала для фрилансеров. Оплачиваю жизнь студийными заказами для нескольких клиентов, пишу еженедельную рассылку, работаю с одним разработчиком на частичной занятости и одним дизайнером на контракте, а ещё готовлюсь к полумарафону.',
    ),
    goals: L(
      'Reach $1,000 of monthly recurring revenue with Lumen by the end of the quarter and cut studio work to two days a week. Ship the team plan and get ten teams on it. Run the half marathon in December and sleep at least seven hours on weekdays.',
      'К концу квартала выйти с Lumen на $1 000 ежемесячной выручки и сократить студийную работу до двух дней в неделю. Выпустить командный тариф и получить десять команд. Пробежать полумарафон в декабре и спать минимум семь часов в будни.',
    ),
    values: L(
      'Be honest with customers and do not promise what I cannot ship. Results over polish. Health and family do not get sacrificed for the product. Keep agreements on time, and if I will be late, say so early.',
      'Честность с клиентами: не обещать того, что не смогу выпустить. Результат важнее лоска. Здоровье и семья не приносятся в жертву продукту. Договорённости выполнять в срок, а если опаздываю — предупреждать заранее.',
    ),
    talkStyle: L(
      'Be brief and concrete. If I am wrong, say so with numbers. Offer two or three options and recommend one. Do not comfort me instead of analysing. Mention sleep once, without lectures.',
      'Говори коротко и по делу. Если я неправ, скажи прямо и с цифрами. Предлагай два-три варианта и один рекомендуй. Не успокаивай вместо разбора. Про сон напоминай один раз, без лекций.',
    ),
    glossary: demoGlossary(),
    updatedAt,
  };
}
