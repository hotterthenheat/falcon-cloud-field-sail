import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AppBoundary } from './components/ui/Fault';
import { applyStoredDefaults } from './core/storedDefaults';
import { bootAnalytics } from './core/analytics';
import { bootSync, watchStorage } from './data/sync';
/* The seed pool is its own chunk. The entry does not wait on it to paint. */
void import('./core/seedPool');
import './index.css';

/* Compass scores entry and runner on 0DTE and the weekly for the whole session, whichever desk is open. */
void import('./data/thetaBook').then(m => m.bootCompass());

/* a default that changed under stored state is carried into storage once, before any page reads it */
applyStoredDefaults();
/* the visit count, only on a build that names the site (core/analytics.ts) */
bootAnalytics();

window.addEventListener('error', (e) => {
  const body = JSON.stringify({ msg: String(e.message).slice(0, 300), path: location.pathname });
  try { navigator.sendBeacon?.('/api/log', new Blob([body], { type: 'application/json' })); } catch { /* a failed beacon is not a second error */ }
});

// NOTE: StrictMode is intentionally off — its dev-mode double-mounting breaks
// react-draggable/react-grid-layout drag initiation (RGL #1959). Dev-only
// diagnostic; production output is identical either way.
const render = () =>
  ReactDOM.createRoot(document.getElementById('root')!).render(
    /* THE NET AROUND EVERYTHING (ui/Fault.tsx, 2026-09-19): the shell has its own for a page, but the landing, the not-found
       page, the rail and the providers had none — an error there was a blank screen */
    <AppBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </AppBoundary>
  );

/* THE STORES' SYNC (2026-10-10, data/sync.ts): signed in, the account's state is pulled BEFORE any store reads its key
   (a short patience — an unreachable service never holds the page), then the browser's writers are watched so every
   change goes up. Signed out, or without the service, this is a moment and nothing more. */
void bootSync()
  .catch(() => undefined)
  .then(() => {
    watchStorage();
    render();
  });
