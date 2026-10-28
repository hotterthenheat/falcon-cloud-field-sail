import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { proxyUw } from './server/uwProxy.mjs';
import { proxyTheta } from './server/thetaProxy.mjs';

try {
  process.loadEnvFile('.env.local');
} catch {
  /* production reads UNUSUAL_WHALES_API_KEY from the host, not a file */
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT ?? 8080);

const logLines: string[] = [];
app.post('/api/log', express.json({ limit: '2kb' }), (req, res) => {
  const msg = typeof req.body?.msg === 'string' ? req.body.msg.slice(0, 300) : '';
  const pathName = typeof req.body?.path === 'string' ? req.body.path.slice(0, 120) : '';
  if (msg) {
    logLines.push(`${new Date().toISOString()} ${pathName} ${msg}`);
    if (logLines.length > 200) logLines.shift();
  }
  res.status(204).end();
});
app.post('/api/stall', (_req, res) => {
  if (!process.env.STALL_KEY) {
    res.status(404).end();
    return;
  }
  res.status(501).end();
});

app.use('/api/uw', (req, res) => {
  void proxyUw(req, res);
});
app.use('/api/theta', (req, res) => {
  void proxyTheta(req, res);
});

// Serve the production build output
app.use(express.static(path.join(__dirname, 'dist')));

// Fallback to index.html for undefined requests (SPA routing)
app.use((_req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n==================================================`);
  console.log(` Slayer Terminal Server Running:`);
  console.log(` http://localhost:${PORT}`);
  console.log(`==================================================\n`);
});
