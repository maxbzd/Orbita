import { pick as L } from '../../../i18n';
import type { CaptureSpec } from '../specs';

/** Short voice notes of ten to thirty seconds, scattered through the timeline. */
export const capturesShort = (): CaptureSpec[] => [
  {
    key: 'c-first-money',
    kind: 'voice',
    at: { d: 53, t: '08:10' },
    context: 'transit',
    title: L('First payment from Nina', 'Первая оплата от Нины'),
    summary: L('Nina paid the deposit on the day she signed.', 'Нина оплатила аванс в день подписания.'),
    text: L(
      `Nina paid the deposit the same day she signed, no reminders. First time the payment is on time and I did not chase. Told Maya at breakfast.`,
      `Нина оплатила аванс в день подписания, без напоминаний. Впервые оплата пришла вовремя и мне не пришлось догонять. Рассказал Майе за завтраком.`,
    ),
    people: ['nina', 'maya'],
    projects: ['studio'],
    tags: L(['money', 'client'], ['деньги', 'клиент']),
  },
  {
    key: 'c-ben-first',
    kind: 'voice',
    at: { d: 35, t: '20:40' },
    context: 'home',
    title: L('Ben’s first screens', 'Первые экраны от Бена'),
    summary: L('Ben delivered the first screens a day early.', 'Бен сдал первые экраны на день раньше срока.'),
    text: L(
      `Ben delivered the first screens a day early, with a short note on what he changed. Told Sam about the portfolio habit: always add a note.`,
      `Бен сдал первые экраны на день раньше, с короткой запиской, что он изменил. Рассказал Сэм про привычку для портфолио: всегда добавлять пояснение.`,
    ),
    people: ['ben', 'sam'],
    projects: ['team'],
    tags: L(['contractor', 'win'], ['подрядчик', 'успех']),
  },
  {
    key: 'c-doc-idea',
    kind: 'voice',
    at: { d: 10, t: '13:15' },
    context: 'transit',
    title: L('A handbook for contractors', 'Справочник для подрядчиков'),
    summary: L('An idea: a single shared handbook for every new contractor.', 'Идея: единый справочник для каждого нового подрядчика.'),
    text: L(
      `An idea on the way: a single handbook for every new contractor, how we work, where files are, what good looks like. Ben could write the first draft.`,
      `Идея по дороге: единый справочник для каждого нового подрядчика, как мы работаем, где лежат файлы, что считается хорошим результатом. Первый черновик мог бы написать Бен.`,
    ),
    people: ['ben'],
    projects: ['team'],
    tags: L(['handbook', 'idea'], ['справочник', 'идея']),
  },
];
