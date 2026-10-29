import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { proxyUw } from './server/uwProxy.mjs';
import { proxyTheta } from './server/thetaProxy.mjs';
import { proxyLogo } from './server/logoProxy.mjs';

try {
  process.loadEnvFile('.env.local');
} catch {
  /* production reads its keys from the host's environment */
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT ?? 8080);

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

app.listen(PORT, () => {
  console.log(`Slayer terminal on http://localhost:${PORT}`);
});
