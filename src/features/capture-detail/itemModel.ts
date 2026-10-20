import { formatDayShort, localDayKey } from '../../domain/dates';
import type { Item, ItemStatus } from '../../domain/types';
import { t } from '../../i18n';

export const ITEM_STATUS_LABELS: Record<ItemStatus, string> = {
  get proposed() { return t('Waiting for confirmation') },
  get active() { return t('Open') },
  get done() { return t('Done') },
  get dropped() { return t('Not relevant') },
  get dismissed() { return t('Dismissed') },
};

export type ItemAction = 'accept' | 'dismiss' | 'done' | 'drop' | 'reopen';

export interface ItemActionSpec {
  action: ItemAction;
  label: string;
  /** The main action of the card (cream button); the other is quiet. */
  primary?: boolean;
}

/** Quick actions of an object by status: decide on a proposal, close an open one, bring a closed one back. */
export function itemActions(status: ItemStatus): ItemActionSpec[] {
  switch (status) {
    case 'proposed':
      return [
        { action: 'accept', label: t('Accept'), primary: true },
        { action: 'dismiss', label: t('Dismiss') },
      ];
    case 'active':
      return [
        { action: 'done', label: t('Done'), primary: true },
        { action: 'drop', label: t('Not relevant') },
      ];
    case 'done':
    case 'dropped':
    case 'dismissed':
      return [{ action: 'reopen', label: t('Restore') }];
  }
}

/** One quiet line under the title: what is particular to the kind (who owes whom, how sure, by when). */
export function itemMeta(item: Item): string | undefined {
  const parts: string[] = [];
  switch (item.kind) {
    case 'commitment': {
      const who = item.counterpartyName;
      parts.push(item.direction === 'i_owe' ? (who ? t('I owe: {who}', { who }) : t('I owe')) : who ? t('Owed to me: {who}', { who }) : t('Owed to me'));
      break;
    }
    case 'prediction':
      parts.push(t('Probability {round} %', { round: Math.round(item.probability * 100) }));
      break;
    case 'decision':
      if (item.chosen && item.chosen !== item.title) parts.push(t('Chosen: {chosen}', { chosen: item.chosen }));
      break;
    default:
      break;
  }
  if (item.dueAt) parts.push(t('due {formatDayShort}', { formatDayShort: formatDayShort(localDayKey(item.dueAt)) }));
  return parts.length > 0 ? parts.join(' · ') : undefined;
}
