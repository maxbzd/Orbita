import { t } from '../../i18n';
/** How to put the app on the home screen, by platform (docs/SPEC.md §4.15 «как установить на экран Домой»). */

export interface InstallHint {
  platform: 'ios' | 'android' | 'desktop';
  title: string;
  steps: string[];
  note?: string;
}

export function detectPlatform(userAgent: string): InstallHint['platform'] {
  if (/iPad|iPhone|iPod/i.test(userAgent)) return 'ios';
  if (/Android/i.test(userAgent)) return 'android';
  return 'desktop';
}

export function installHint(userAgent: string, standalone: boolean): InstallHint {
  const platform = detectPlatform(userAgent);
  if (standalone) {
    return { platform, title: t('The app is already installed on your home screen.'), steps: [t('Recording opens from the icon in one tap.')] };
  }
  if (platform === 'ios') {
    return {
      platform,
      title: t('How to add to the home screen (iPhone, iPad)'),
      steps: [t('Open Orbita in Safari.'), t('Tap “Share” (the square with an arrow).'), t('Choose “Add to Home Screen” and tap “Add”.')],
      note: t('Safari only: installing is not available in other browsers on iPhone.'),
    };
  }
  if (platform === 'android') {
    return {
      platform,
      title: t('How to add to the home screen (Android)'),
      steps: [t('Open Orbita in Chrome.'), t('Tap the ⋮ menu in the corner.'), t('Choose “Install app” or “Add to home screen”.')],
      note: t('A long press on the icon shows quick actions: “Record” and “State”.'),
    };
  }
  return {
    platform,
    title: t('How to install on a computer'),
    steps: [t('In Chrome or Edge, click the install icon on the right of the address bar.'), t('Or open the browser menu and choose “Install Orbita”.')],
    note: t('The installed app opens in its own window, without tabs.'),
  };
}
