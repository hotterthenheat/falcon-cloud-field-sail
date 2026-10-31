import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { proxyUw } from './server/uwProxy.mjs';
import { proxyTheta } from './server/thetaProxy.mjs';
import { proxyLogo } from './server/logoProxy.mjs';
import { compassMount, installProcessLogger } from './server/compassApi.mjs';
import { exposureMount } from './server/exposureApi.mjs';

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
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

const server = app.listen(PORT, () => {
  console.log(`Slayer terminal on http://localhost:${PORT}`);
  void compass.start();
  void exposure.start();
});

/* a clean stop: the record is written and the engine's lock let go before the process ends */
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    compass.stop();
    exposure.stop();
    server.close();
    process.exit(0);
  });
}
