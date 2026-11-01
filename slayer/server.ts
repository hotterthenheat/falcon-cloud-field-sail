import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { proxyUw } from './server/uwProxy.mjs';
import { proxyTheta } from './server/thetaProxy.mjs';
import { proxyLogo } from './server/logoProxy.mjs';
import { compassMount, installProcessLogger } from './server/compassApi.mjs';
import { exposureMount } from './server/exposureApi.mjs';
import { volOutlookMount } from './server/volOutlookApi.mjs';
import { proxyRegime } from './server/regimeApi.mjs';
import { proxyOiChange } from './server/oiChangeApi.mjs';
import { tapeMount } from './server/tapeApi.mjs';

try {
  process.loadEnvFile('.env.local');
} catch {
  /* production reads its keys from the host's environment */
}

/* a promise or exception nobody caught is logged, not lost */
installProcessLogger();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT ?? 8080);

/* the official Compass engine (src/data/compassServer.ts): it scans from start to shutdown, viewers or not */
const COMPASS_ENGINE = './src/data/compassServer.ts';
const compass = compassMount(() => import(COMPASS_ENGINE), __dirname);
app.use('/api/compass', (req, res) => {
  void compass.handle(req, res);
});
/* the exposure recorder (src/data/exposureRecorder.ts): Terrain's per-strike field, read every minute, viewers or not */
const EXPOSURE_RECORDER = './src/data/exposureRecorder.ts';
const exposure = exposureMount(() => import(EXPOSURE_RECORDER), __dirname);
app.use('/api/exposure', (req, res) => {
  void exposure.handle(req, res);
});
/* the vol outlook's sessions (src/data/volOutlookServer.ts): each name's year of minutes read once a day, not per viewer */
const VOL_OUTLOOK = './src/data/volOutlookServer.ts';
const vol = volOutlookMount(() => import(VOL_OUTLOOK), __dirname);
app.use('/api/vol-outlook', (req, res) => {
  void vol.handle(req, res);
});
/* Terrain's vol regime (server/regimeApi.mjs): read once here for every pane and viewer */
app.use('/api/regime', (req, res) => {
  void proxyRegime(req, res, __dirname);
});
/* Building's complete open-interest change (server/oiChangeApi.mjs): one terminal read a report date, for every viewer */
app.use('/api/oi-change', (req, res) => {
  void proxyOiChange(req, res, __dirname);
});
/* the option and stock tapes (src/data/tapeServer.ts): one per name, read here and shared by every viewer */
const TAPES = './src/data/tapeServer.ts';
const tape = tapeMount(() => import(TAPES), __dirname);
app.use('/api/tape', (req, res) => {
  void tape.handle(req, res);
});
app.use('/api/uw', (req, res) => {
  void proxyUw(req, res);
});
app.use('/api/theta', (req, res) => {
  void proxyTheta(req, res);
});
app.use('/api/logo', (req, res) => {
  void proxyLogo(req, res);
});
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'not found' });
});

app.use(express.static(path.join(__dirname, 'dist')));

/* every other path is the single-page app */
app.use((_req, res) => {
  /* `root`, not an absolute path: send refuses any path with a dot-folder in it (a checkout under .claude/worktrees
     answered 404 for every page but /), and with a root only the file's own path is checked */
  res.sendFile('index.html', { root: path.join(__dirname, 'dist') });
});

const server = app.listen(PORT, () => {
  console.log(`Slayer terminal on http://localhost:${PORT}`);
  void compass.start();
  void exposure.start();
  void vol.start();
});

/* a clean stop: the record is written and the engine's lock let go before the process ends */
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    compass.stop();
    exposure.stop();
    vol.stop();
    tape.stop();
    server.close();
    process.exit(0);
  });
}
