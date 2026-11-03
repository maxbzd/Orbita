import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { registerSW } from 'virtual:pwa-register';
import { requestPersistentStorage, runStartupMaintenance } from './db';
import { initLocale, msg } from './i18n';
import { LocaleRoot } from './i18n/react';
import { VaultGate } from './features/vault/VaultGate';
import { router } from './routes';
import './styles/global.css';

const root = document.getElementById('root');
if (!root) throw new Error(msg('Container #root not found'));

// The language is resolved (and its dictionary loaded) before the first render, so nothing flashes in the wrong one.
/** Everything that reads or writes the database waits for the vault (if encryption is on) to be open. */
function startServices(): void {
  void runStartupMaintenance();
  void requestPersistentStorage();
}

void initLocale().then(() => {
  createRoot(root).render(
    <StrictMode>
      <LocaleRoot>
        <VaultGate onReady={startServices}>
          <RouterProvider router={router} />
        </VaultGate>
      </LocaleRoot>
    </StrictMode>,
  );
});

if (import.meta.env.DEV || import.meta.env.VITE_E2E) void import('./devtools');


// The service worker only exists in production builds; a new version waits for the next launch.
if (import.meta.env.PROD) registerSW();
