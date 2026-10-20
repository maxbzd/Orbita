import { t, msg } from '../i18n';
/** Tab / task-switcher title for a route: «Сегодня · Орбита». Unknown paths keep the bare app name. */
const APP_NAME = msg('Orbita');

const TITLES: Record<string, string> = {
  get today() { return t('Today') },
  get checkin() { return t('State') },
  get stream() { return t('Stream') },
  get entry() { return t('Record') },
  get review() { return t('Record review') },
  get ask() { return t('Ask') },
  get orbit() { return t('Time') },
  get items() { return t('Collections') },
  get people() { return t('People') },
  get patterns() { return t('Patterns') },
  get reviews() { return t('Reviews') },
  get me() { return t('Me') },
  get settings() { return t('Settings') },
  get context() { return t('Context for AI') },
  get capture() { return t('New recording') },
  get onboarding() { return t('Getting started') },
  get share() { return t('Share') },
  get lock() { return t('Lock') },
};

export function documentTitleFor(pathname: string): string {
  const first = pathname.split('/').filter(Boolean)[0];
  const title = first ? TITLES[first] : undefined;
  return title ? `${title} · ${t(APP_NAME)}` : t(APP_NAME);
}
