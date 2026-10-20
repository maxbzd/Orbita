import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import { requestPersistentStorage, runStartupMaintenance } from './db';
import { initLocale, msg } from './i18n';
import { LocaleRoot } from './i18n/react';
import { providerFuture, router } from './routes';
import './styles/global.css';

const root = document.getElementById('root');
if (!root) throw new Error(msg('Container #root not found'));

// The language is resolved (and its dictionary loaded) before the first render, so nothing flashes in the wrong one.
void initLocale().then(() => {
  createRoot(root).render(
    <StrictMode>
      <LocaleRoot>
        <RouterProvider router={router} future={providerFuture} />
      </LocaleRoot>
    </StrictMode>,
  );
});

if (import.meta.env.DEV || import.meta.env.VITE_E2E) void import('./devtools');

void runStartupMaintenance();
void requestPersistentStorage();

// The service worker only exists in production builds; a new version waits for the next launch.
if (import.meta.env.PROD) registerSW();
