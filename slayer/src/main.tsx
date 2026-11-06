import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AppBoundary } from './components/ui/Fault';
import { applyStoredDefaults } from './core/storedDefaults';
import { bootAnalytics } from './core/analytics';
import { bootSync, watchStorage } from './data/sync';
import { installErrorLog } from './data/diagnostics';
import './index.css';

/* the last few console errors, scrubbed as they are kept, for a bug report the reader chooses to make (data/diagnostics.ts) */
installErrorLog();
/* a default that changed under stored state is carried into storage once, before any page reads it */
applyStoredDefaults();
/* the visit count, only on a build that names the site (core/analytics.ts) */
bootAnalytics();

// NOTE: StrictMode is intentionally off — its dev-mode double-mounting breaks
// react-draggable/react-grid-layout drag initiation (RGL #1959). Dev-only
// diagnostic; production output is identical either way.
const render = () =>
  ReactDOM.createRoot(document.getElementById('root')!).render(
    /* the outermost boundary: the landing, the rail and the providers have no page boundary of their own */
    <AppBoundary>
      {/* a navigation is a transition: a page whose code is still on its way leaves the current one on screen */}
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <App />
      </BrowserRouter>
    </AppBoundary>
  );

/* The page renders at once; the account's stored state is pulled behind it, and the storage watcher is installed only
   after the pull so its writes are not heard as local changes (data/sync.ts). */
render();
void bootSync()
  .catch(() => undefined)
  .then(() => watchStorage());
