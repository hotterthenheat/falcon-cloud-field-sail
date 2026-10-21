import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AppBoundary } from './components/ui/Fault';
import { applyStoredDefaults } from './core/storedDefaults';
import { bootAnalytics } from './core/analytics';
import { bootSync, watchStorage } from './data/sync';
/* the seed pool registers itself with the simulator: histories are walked in workers from the first boot */
import './core/seedPool';
import './index.css';

/* a default that changed under stored state is carried into storage once, before any page reads it */
applyStoredDefaults();
/* the visit count, only on a build that names the site (core/analytics.ts) */
bootAnalytics();

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
