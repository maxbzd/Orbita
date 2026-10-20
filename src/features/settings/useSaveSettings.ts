import { useCallback } from 'react';
import { updateSettings } from '../../db';
import type { SettingsPatch } from '../../db';
import { useToast } from '../../ui';
import { t } from '../../i18n';

/** Saves a patch of the settings; a failed write is told to the user instead of being lost silently. */
export function useSaveSettings(): (patch: SettingsPatch) => Promise<void> {
  const toast = useToast();
  return useCallback(
    async (patch) => {
      try {
        await updateSettings(patch);
      } catch (error) {
        console.error(t('Could not save the settings'), error);
        toast.show({ message: t('Could not save the settings. Try again.'), tone: 'danger' });
      }
    },
    [toast],
  );
}
