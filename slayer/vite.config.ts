import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { proxyUw } from './server/uwProxy.mjs';
import { proxyNameCard } from './server/nameCard.mjs';
import { proxyTheta } from './server/thetaProxy.mjs';
import { proxyLogo } from './server/logoProxy.mjs';
import { compassMount, installProcessLogger } from './server/compassApi.mjs';
import { exposureMount } from './server/exposureApi.mjs';
import { volOutlookMount } from './server/volOutlookApi.mjs';
import { proxyRegime } from './server/regimeApi.mjs';
import { proxyOiChange } from './server/oiChangeApi.mjs';
import { tapeMount } from './server/tapeApi.mjs';
import { proxyTerrain } from './server/terrainApi.mjs';
import { superviseTheta } from './theta/supervisor.mjs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import nodePath from 'node:path';

/* The data proxies (server/) run inside the dev and preview servers; their keys stay in this process.
   Any other /api path answers 404 instead of falling through to the SPA's index.html. */
const dataProxies = (): Plugin => {
  const mount = (
    use: (path: string, fn: (req: IncomingMessage, res: ServerResponse) => void) => void,
    compass?: ReturnType<typeof compassMount>,
    exposure?: ReturnType<typeof exposureMount>,
    vol?: ReturnType<typeof volOutlookMount>,
    tape?: ReturnType<typeof tapeMount>,
  ) => {
    if (compass) use('/api/compass', (req, res) => void compass.handle(req, res));
    if (exposure) use('/api/exposure', (req, res) => void exposure.handle(req, res));
    if (vol) use('/api/vol-outlook', (req, res) => void vol.handle(req, res));
    /* Terrain's vol regime (server/regimeApi.mjs): read once here for every pane and viewer */
    use('/api/regime', (req, res) => void proxyRegime(req, res));
    /* Building's complete open-interest change (server/oiChangeApi.mjs): one terminal read a report date, for every viewer */
    use('/api/oi-change', (req, res) => void proxyOiChange(req, res));
    if (tape) use('/api/tape', (req, res) => void tape.handle(req, res));
    /* Terrain's option chain and its prior close (server/terrainApi.mjs): read once here for every pane and viewer */
    use('/api/terrain', (req, res) => void proxyTerrain(req, res));
    /* a name's card for Terrain's name search (server/nameCard.mjs): four hub reads in one answer */
    use('/api/name-card', (req, res) => void proxyNameCard(req, res));
    use('/api/uw', (req, res) => void proxyUw(req, res));
    use('/api/theta', (req, res) => void proxyTheta(req, res));
    use('/api/logo', (req, res) => void proxyLogo(req, res));
    use('/api', (_req, res) => {
      res.statusCode = 404;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'not found' }));
    });
  };
  return {
    name: 'data-proxies',
    configureServer(server) {
      /* a promise or exception nobody caught is logged, not lost */
      installProcessLogger();
      /* the app shell is the same document for every room. Vite rebuilds it on each hit; keep one copy. */
      let shell: { at: number; body: Buffer } | null = null;
      const shellFresh = () => shell && Date.now() - shell.at < 30_000;
      const takeShell = (buf: Buffer) => {
        if (buf.includes('<html') || buf.includes('<HTML')) shell = { at: Date.now(), body: buf };
      };
      server.middlewares.use((req, res, next) => {
        const path = (req.url || '/').split('?')[0];
        const spa = req.method === 'GET' && !req.headers['x-shell-raw'] && !path.startsWith('/api') && !path.startsWith('/@') && !path.startsWith('/src') && !path.startsWith('/node_modules') && !path.includes('.');
        if (!spa || !shellFresh() || !shell) return next();
        res.statusCode = 200;
        res.setHeader('content-type', 'text/html');
        res.setHeader('cache-control', 'no-cache');
        res.end(shell.body);
      });
      const warmShell = () => {
        void fetch('http://127.0.0.1:8080/', { headers: { 'x-shell-raw': '1' } }).then(async r => {
          if (!r.ok) return;
          takeShell(Buffer.from(await r.arrayBuffer()));
        }).catch(() => {});
      };
      /* the official Compass engine (src/data/compassServer.ts) runs in this process from the moment it listens */
      const compass = compassMount(() => server.ssrLoadModule('/src/data/compassServer.ts'));
      /* the exposure recorder (src/data/exposureRecorder.ts): Terrain's per-strike field, read every minute, viewers or not */
      const exposure = exposureMount(() => server.ssrLoadModule('/src/data/exposureRecorder.ts'));
      /* the vol outlook's sessions (src/data/volOutlookServer.ts): a name's year of minutes read once a day here, not per viewer */
      const vol = volOutlookMount(() => server.ssrLoadModule('/src/data/volOutlookServer.ts'));
      /* the option and stock tapes (src/data/tapeServer.ts): one per name, read here and shared by every viewer */
      const tape = tapeMount(() => server.ssrLoadModule('/src/data/tapeServer.ts'));
      mount((path, fn) => server.middlewares.use(path, fn), compass, exposure, vol, tape);
      server.httpServer?.once('listening', () => void compass.start());
      server.httpServer?.once('listening', () => void exposure.start());
      server.httpServer?.once('listening', () => void vol.start());
      server.httpServer?.once('listening', () => void tape.start());
      server.httpServer?.once('listening', () => {
        warmShell();
        const again = setInterval(warmShell, 30_000);
        again.unref?.();
        server.httpServer?.once('close', () => clearInterval(again));
      });
      server.httpServer?.once('close', () => compass.stop());
      server.httpServer?.once('close', () => exposure.stop());
      server.httpServer?.once('close', () => vol.stop());
      server.httpServer?.once('close', () => tape.stop());
      /* one ThetaData terminal for local work (theta/supervisor.mjs); THETA_AUTOSTART=0 leaves it to `npm run theta`, and
         a machine that shares the always-on terminal (THETA_RELAY_URL) never starts its own */
      if (process.env.THETA_AUTOSTART !== '0' && !process.env.THETA_RELAY_URL) {
        const stop = superviseTheta();
        if (stop) server.httpServer?.once('close', stop);
      }
    },
    configurePreviewServer(server) {
      installProcessLogger();
      const file = pathToFileURL(nodePath.join(process.cwd(), 'src/data/compassServer.ts')).href;
      const compass = compassMount(async () => (await import('tsx/esm/api')).tsImport(file, import.meta.url));
      const exposureFile = pathToFileURL(nodePath.join(process.cwd(), 'src/data/exposureRecorder.ts')).href;
      const exposure = exposureMount(async () => (await import('tsx/esm/api')).tsImport(exposureFile, import.meta.url));
      const volFile = pathToFileURL(nodePath.join(process.cwd(), 'src/data/volOutlookServer.ts')).href;
      const vol = volOutlookMount(async () => (await import('tsx/esm/api')).tsImport(volFile, import.meta.url));
      const tapeFile = pathToFileURL(nodePath.join(process.cwd(), 'src/data/tapeServer.ts')).href;
      const tape = tapeMount(async () => (await import('tsx/esm/api')).tsImport(tapeFile, import.meta.url));
      mount((path, fn) => server.middlewares.use(path, fn), compass, exposure, vol, tape);
      server.httpServer?.once('listening', () => void compass.start());
      server.httpServer?.once('listening', () => void exposure.start());
      server.httpServer?.once('listening', () => void vol.start());
      server.httpServer?.once('listening', () => void tape.start());
      server.httpServer?.once('close', () => compass.stop());
      server.httpServer?.once('close', () => exposure.stop());
      server.httpServer?.once('close', () => vol.stop());
      server.httpServer?.once('close', () => tape.stop());
    },
  };
};

/* server-side settings read from .env files the way the host's environment would provide them */
const SERVER_ENV = [
  'UNUSUAL_WHALES_API_KEY',
  'THETADATA_API_KEY',
  'THETA_RELAY_URL',
  'THETA_RELAY_SECRET',
  'THETA_JAR',
  'THETA_JAVA',
  'THETA_AUTOSTART',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_PUBLISHABLE_KEY',
  'UW_PROXY_OPEN',
  'PROXY_PLAN_GATE',
  'PROXY_RATE_BURST',
  'PROXY_RATE_PER_SEC',
  'EXPOSURE_RECORDER',
  'EXPOSURE_DIR',
  'EXPOSURE_NAMES',
  'EXPOSURE_NAMES_MAX',
  'EXPOSURE_KEEP_DAYS',
  'EXPOSURE_FRONT',
  'EXPOSURE_EXT_EVERY',
];

/* Vendor libraries in a few stable chunks: fewer requests on first load, and an app deploy leaves them cached. */
const VENDOR_CHUNKS: [string, RegExp][] = [
  ['vendor-react', /node_modules\/(react|react-dom|scheduler|react-router|react-router-dom|@remix-run\/router)\//],
  ['vendor-motion', /node_modules\/(framer-motion|motion-dom|motion-utils)\//],
  ['vendor-supabase', /node_modules\/@supabase\//],
  ['vendor-grid', /node_modules\/(ag-grid-community|ag-grid-react)\//],
  ['vendor-charts', /node_modules\/(lightweight-charts|fancy-canvas)\//],
  ['vendor-codemirror', /node_modules\/(@codemirror|@lezer|codemirror|style-mod|w3c-keyname|crelt)\//],
  ['vendor-radix', /node_modules\/(@radix-ui|@floating-ui)\//],
];
const manualChunks = (id: string): string | undefined => VENDOR_CHUNKS.find(([, re]) => re.test(id))?.[0];

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  for (const name of SERVER_ENV) {
    if (env[name] && !process.env[name]) process.env[name] = env[name];
  }
  return {
  plugins: [react(), dataProxies()],
  server: {
    host: '0.0.0.0',
    port: 8080,
    strictPort: true,
    /* no HMR socket: a hidden tab dropping it would reload the page */
    hmr: false,
    /* compile the entry and the first rooms at startup, so the first visit does not wait on a cold transform */
    warmup: {
      clientFiles: [
        './src/main.tsx',
        './src/pages/landing/Landing.tsx',
        './src/pages/workspace/Pulse.tsx',
        './src/pages/pinpoint/PinpointLayout.tsx',
        './src/pages/pinpoint/MapDesk.tsx',
        './src/pages/record/RecordLayout.tsx',
        './src/pages/record/News.tsx',
      ],
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks,
        /* merge tiny chunks (skeletons, small helpers) into their neighbours to cut the request waterfall */
        experimentalMinChunkSize: 20_000,
      },
    },
  },
  resolve: {
    /* `@/` is src/ (the shadcn components' alias; tsconfig.json `paths` says the same to the type checker) */
    alias: { '@': nodePath.join(nodePath.dirname(fileURLToPath(import.meta.url)), 'src') },
    /* one React, even when the pre-bundle is regenerated mid-session */
    dedupe: ['react', 'react-dom'],
  },
  define: {
    /* react-draggable reads process.env in the browser. Empty on purpose: the real env would ship the server keys. */
    'process.env': {},
  },
  };
});
